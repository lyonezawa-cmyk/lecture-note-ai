const STORAGE_KEY = "lecture-note-ai-gemini-key";
const MAX_INLINE_MEDIA_BYTES = 18 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = [".m4a", ".mp3", ".wav", ".aac", ".webm", ".mov", ".mp4"];
const MIME_FALLBACKS = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4"
};

const elements = {
  apiKey: document.querySelector("#apiKey"),
  keyState: document.querySelector("#keyState"),
  toggleKey: document.querySelector("#toggleKey"),
  saveKey: document.querySelector("#saveKey"),
  clearKey: document.querySelector("#clearKey"),
  lectureTitle: document.querySelector("#lectureTitle"),
  audioFile: document.querySelector("#audioFile"),
  fileInfo: document.querySelector("#fileInfo"),
  modelName: document.querySelector("#modelName"),
  language: document.querySelector("#language"),
  runButton: document.querySelector("#runButton"),
  status: document.querySelector("#status"),
  transcriptOutput: document.querySelector("#transcriptOutput"),
  summaryOutput: document.querySelector("#summaryOutput"),
  pointsOutput: document.querySelector("#pointsOutput")
};

function boot() {
  const savedKey = localStorage.getItem(STORAGE_KEY);
  if (savedKey) {
    elements.apiKey.value = savedKey;
  }
  updateKeyState();
}

function updateKeyState() {
  const hasKey = Boolean(elements.apiKey.value.trim());
  elements.keyState.textContent = hasKey ? "保存済み" : "未保存";
  elements.keyState.classList.toggle("is-saved", hasKey);
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
}

function setRunning(isRunning) {
  elements.runButton.disabled = isRunning;
  elements.runButton.textContent = isRunning ? "処理中..." : "文字起こしと要約を実行";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileExtension(file) {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.find((extension) => name.endsWith(extension)) || "";
}

function isSupportedMediaFile(file) {
  return file.type.startsWith("audio/")
    || file.type.startsWith("video/")
    || Boolean(getFileExtension(file));
}

function getMimeType(file) {
  return file.type || MIME_FALLBACKS[getFileExtension(file)] || "audio/mpeg";
}

function describeFileIssue(file) {
  if (!file) {
    return "";
  }
  if (!isSupportedMediaFile(file)) {
    return "対応形式はm4a/mp3/wav/aac/webm/mov/mp4です。";
  }
  if (file.size > MAX_INLINE_MEDIA_BYTES) {
    return `ファイルが大きすぎます（${formatBytes(file.size)}）。18MB以下、30秒〜2分程度に短くしてください。`;
  }
  return "";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function callGemini({ apiKey, model, parts, responseMimeType }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts
      }
    ],
    generationConfig: {
      temperature: 0.2
    }
  };

  if (responseMimeType) {
    body.generationConfig.responseMimeType = responseMimeType;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Geminiからテキストを取得できませんでした。音声が短すぎる、または形式が対応外の可能性があります。");
  }
  return text;
}

async function transcribeAudio({ apiKey, model, language, file, title }) {
  const base64Audio = await fileToBase64(file);
  const prompt = [
    `この音声または動画内の音声を${language}で正確に文字起こししてください。`,
    "講義や自習の録音として扱い、聞き取れない箇所は「[聞き取り不可]」と書いてください。",
    "要約や解説は入れず、文字起こし本文だけを返してください。",
    title ? `講義名: ${title}` : ""
  ].filter(Boolean).join("\n");

  return callGemini({
    apiKey,
    model,
    parts: [
      { text: prompt },
      {
        inlineData: {
          mimeType: getMimeType(file),
          data: base64Audio
        }
      }
    ]
  });
}

async function summarizeTranscript({ apiKey, model, language, transcript, title }) {
  const prompt = [
    `以下の文字起こしを${language}で学習ノート用に整理してください。`,
    title ? `講義名: ${title}` : "",
    "必ずJSONだけを返してください。",
    "形式: {\"summary\":[\"1行目\",\"2行目\",\"3行目\"],\"points\":[\"要点1\",\"要点2\",\"要点3\"]}",
    "summaryは必ず3行、pointsは3から5個にしてください。",
    "",
    "文字起こし:",
    transcript
  ].filter(Boolean).join("\n");

  const raw = await callGemini({
    apiKey,
    model,
    responseMimeType: "application/json",
    parts: [{ text: prompt }]
  });

  return parseSummary(raw);
}

function parseSummary(raw) {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const summary = Array.isArray(parsed.summary) ? parsed.summary : [String(parsed.summary || "")];
    const points = Array.isArray(parsed.points) ? parsed.points : [String(parsed.points || "")];
    return {
      summary: summary.filter(Boolean).slice(0, 3),
      points: points.filter(Boolean).slice(0, 5)
    };
  } catch {
    return {
      summary: cleaned.split(/\n+/).filter(Boolean).slice(0, 3),
      points: cleaned.split(/\n+/).filter(Boolean).slice(3, 8)
    };
  }
}

function validateInputs() {
  const apiKey = elements.apiKey.value.trim();
  const file = elements.audioFile.files[0];

  if (!apiKey) {
    throw new Error("Gemini APIキーを入力してください。");
  }
  if (!file) {
    throw new Error("音声ファイルを選択してください。");
  }
  if (!isSupportedMediaFile(file)) {
    throw new Error("対応形式はm4a/mp3/wav/aac/webm/mov/mp4です。");
  }
  if (file.size > MAX_INLINE_MEDIA_BYTES) {
    throw new Error("このサンプル版では18MB以下の短い音声または動画を選択してください。iPhoneの動画は30秒〜2分程度に短くしてから使ってください。");
  }

  return {
    apiKey,
    file,
    model: elements.modelName.value,
    language: elements.language.value,
    title: elements.lectureTitle.value.trim()
  };
}

async function run() {
  try {
    const input = validateInputs();
    localStorage.setItem(STORAGE_KEY, input.apiKey);
    updateKeyState();
    setRunning(true);
    setStatus("音声を読み込んでいます...");
    elements.transcriptOutput.value = "";
    elements.summaryOutput.value = "";
    elements.pointsOutput.value = "";

    setStatus("Geminiで文字起こし中です...");
    const transcript = await transcribeAudio(input);
    elements.transcriptOutput.value = transcript;

    setStatus("文字起こしを元に要約を作成中です...");
    const result = await summarizeTranscript({ ...input, transcript });
    elements.summaryOutput.value = result.summary.join("\n");
    elements.pointsOutput.value = result.points.map((point) => `- ${point}`).join("\n");

    setStatus("完了しました。必要な欄をコピーできます。");
  } catch (error) {
    setStatus(error.message || "処理に失敗しました。", true);
  } finally {
    setRunning(false);
  }
}

async function copyFrom(targetId) {
  const target = document.getElementById(targetId);
  const text = target.value.trim();
  if (!text) {
    setStatus("コピーする内容がまだありません。", true);
    return;
  }

  await navigator.clipboard.writeText(text);
  setStatus("コピーしました。");
}

elements.saveKey.addEventListener("click", () => {
  const key = elements.apiKey.value.trim();
  if (!key) {
    setStatus("保存するAPIキーを入力してください。", true);
    return;
  }
  localStorage.setItem(STORAGE_KEY, key);
  updateKeyState();
  setStatus("APIキーをこの端末に保存しました。");
});

elements.clearKey.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  elements.apiKey.value = "";
  updateKeyState();
  setStatus("保存済みのAPIキーを削除しました。");
});

elements.toggleKey.addEventListener("click", () => {
  const isPassword = elements.apiKey.type === "password";
  elements.apiKey.type = isPassword ? "text" : "password";
  elements.toggleKey.textContent = isPassword ? "非表示" : "表示";
});

elements.apiKey.addEventListener("input", updateKeyState);

elements.audioFile.addEventListener("change", () => {
  const file = elements.audioFile.files[0];
  const issue = describeFileIssue(file);
  elements.fileInfo.textContent = file
    ? issue || `${file.name} / ${formatBytes(file.size)}`
    : "30秒から2分程度の短い音声で試してください";
  elements.fileInfo.classList.toggle("is-warning", Boolean(issue));
});

elements.runButton.addEventListener("click", run);

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", () => copyFrom(button.dataset.copyTarget));
});

boot();
