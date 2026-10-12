# claude-code-mod-prompt-templates

[English](README.md) | 日本語

Claude Code の入力欄のすぐ上にボタンを並べ、数字キーでプロンプトテンプレートを入力欄に挿入する Mod（function hooks プラグイン）です。挿入するだけで送信はしないので、内容を確認・追記してから送信できます。

![入力欄の上のテンプレートのボタン](docs/images/button-row.png)

`1` を押すとテンプレートが入力欄に入ります。入力欄が空でなくなったので、行の末尾の案内も切り替わります。

![入力欄に挿入されたテンプレート](docs/images/inserted.png)

動作確認したバージョン: Claude Code 2.1.287（Mod API は EARLY ACCESS のため、今後のリリースで動かなくなる可能性があります）

## 導入

### 1. 必要なもの

- Claude Code 2.1.287 以降（`claude --version` で確認）

### 2. Mod を入手する

このリポジトリを好きな場所に clone（またはダウンロード）します。以下の例では `~/cc-mods-prompts` に置きます。

```sh
git clone https://github.com/NaokiIshimura/claude-code-mod-prompt-templates.git ~/cc-mods-prompts
```

### 3. Mod を読み込む

Mod はフォルダから読み込みます。次のどちらかを選んでください。

#### 方法 A: そのセッションだけ使う

起動時にフォルダを指定します。手元の設定を何も変えないので、試すときはこれが手軽です。

```sh
claude --plugin-dir ~/cc-mods-prompts
```

#### 方法 B: いつも使う

`~/.claude/settings.json` の `env` にフォルダを追加し、Claude Code を起動し直します。desktop アプリのように起動オプションを渡せない場合も、この方法で読み込まれます。

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/cc-mods-prompts"
  }
}
```

- パスは絶対パスで書きます（`~` も使えます）
- 複数の Mod を読み込むときは、フォルダを `:`（Windows は `;`）で区切ります
- `settings.json` にすでに `env` がある場合は、その中に1行追加します

### 4. テンプレートを置く

テンプレートは `~/.claude/prompt-templates/` に置きます（[テンプレート](#テンプレート) を参照）。サンプルから始める場合は、`examples/prompt-templates/ja/` の日本語版をコピーします（英語版は `examples/prompt-templates/en/`）。

```sh
mkdir -p ~/.claude/prompt-templates
cp ~/cc-mods-prompts/examples/prompt-templates/ja/*.md ~/.claude/prompt-templates/
```

### 5. 動作を確認する

Claude Code を起動すると、入力欄のすぐ上に `Templates:  1: review  2: explain  3: bugfix` のような行が出ます。`/tpl-reload` を実行すると `Loaded 3 templates` と返ります。

行が出ない場合は `claude --debug` で起動し、デバッグログの `prompt-templates` を含む行を確認してください。

### 更新

フォルダで `git pull` します。対話セッションの実行中はファイルの変更で Mod が自動的に読み込み直されます。そうでない場合は Claude Code を起動し直してください。

### アンインストール

`--plugin-dir` の指定をやめるか、`CLAUDE_CODE_PLUGIN_DIRS` からフォルダを外します。そのうえでフォルダを削除し、テンプレートが不要なら `~/.claude/prompt-templates/` も削除します。

## 使い方

### ボタンの押し方

| 状況 | 押し方 | 帯の末尾の案内 |
| --- | --- | --- |
| 入力欄が空 | 数字キーを押す | `(press a number on an empty prompt)` |
| 入力欄に下書きがある | ctrl+x → tab で帯を選択してから数字キー（Esc で入力欄に戻る） | `(focus buttons: ctrl + x > tab)` |
| fullscreen のターミナル / desktop アプリ | ボタンをクリックしてもよい | （出さない） |

- 通常画面のターミナル（tmux 内など）ではクリックが届かないため、キーで押します
- 先頭の 9 件に `1`〜`9` を割り当てます。10 件以上あるときは `0: More…` から一覧を開いて選びます
- 帯は `/tpl-bar` で隠す・再表示できます
- モデルの応答中でも挿入できます
- 帯と入力欄の間の空行は Claude Code が入力欄の上に置く標準の余白で、Mod からは詰められません

### コマンド

ボタンが出ない環境（VS Code 拡張・モバイル）や、帯を隠しているときにも使えます。

| コマンド | 内容 |
| --- | --- |
| `/tpl <名前>` | テンプレートを挿入する（キー → 表示名の順に探す。大文字小文字は区別しない） |
| `/tpl` | テンプレートの一覧を開く |
| `/tpl-bar` | ボタン帯の表示・非表示を切り替える |
| `/tpl-reload` | テンプレートを読み込み直す（ファイルを追加・変更したとき） |

## テンプレート

### 置き場所

| 置き場所 | 用途 |
| --- | --- |
| `~/.claude/prompt-templates/*.md` | どのプロジェクトでも使うテンプレート |
| `<プロジェクト>/.claude/prompt-templates/*.md` | そのプロジェクトだけのテンプレート。同じファイル名ならこちらを優先する |

### 形式

1 ファイル 1 テンプレートの Markdown です。ファイル名（`.md` を除く）がキーになります。先頭の frontmatter は任意です。

```markdown
---
label: review
mode: replace
order: 1
---
直前の変更をレビューしてください。
```

| 項目 | 内容 | 省略したとき |
| --- | --- | --- |
| `label` | ボタンに出す名前 | ファイル名 |
| `mode` | `insert`（カーソル位置に挿入）/ `replace`（下書きを置き換え）/ `append`（末尾に追加） | `insert` |
| `order` | 並び順（数値の昇順） | `order` のあるものの後ろに、名前順で並ぶ |

本文の末尾の改行は除いて挿入します。

## 開発

```sh
claude plugin validate .   # manifest とフックの検査
claude plugin test .       # hooks/*.test.ts(x) を実行
```

| ファイル | 内容 |
| --- | --- |
| `hooks/register.tsx` | フック・描画・コマンド。`$` と状態は import 先の関数と受け渡しできないため、このファイルにまとめている |
| `hooks/parse.ts` | テンプレートの解析・並べ替えなどの純粋関数 |
| `types/index.d.ts` | テンプレートの型と `$.state` の型契約 |
| `hooks/*.test.ts(x)` | テスト |
