# Lecture Note AI

スマホ対応の静的Webアプリです。講義や自習の短い音声ファイルをGemini APIへ送り、文字起こし全文、3行要約、要点3〜5個を表示します。

## 使い方

1. `index.html`をブラウザで開く
2. Gemini APIキーを入力して保存
3. 講義名を入力
4. 短い音声ファイルを選択
5. 「文字起こしと要約を実行」を押す

APIキーはブラウザの`localStorage`に保存されます。ソースコードやGitHubリポジトリには含めません。

## GitHub Pagesで公開する

1. GitHubで新しいリポジトリを作る
2. `index.html`、`styles.css`、`app.js`、`README.md`、`.nojekyll`をリポジトリ直下に置く
3. GitHubの`Settings` → `Pages`を開く
4. `Build and deployment`の`Source`を`Deploy from a branch`にする
5. `Branch`を`main`、フォルダを`/ (root)`にして保存する

公開後は数分で`https://ユーザー名.github.io/リポジトリ名/`から開けます。

## 注意

個人情報や機密情報を含む音声は送信しないでください。最初は30秒から2分程度の短い講義サンプルで試してください。
