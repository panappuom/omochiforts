# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## デプロイ運用

このプロジェクトは GitHub Pages と独自ドメインの両方で運用できます。ビルド時に `DEPLOY_TARGET` 環境変数を参照して設定を切り替えます。

| DEPLOY_TARGET | site | base | robots.txt |
| --- | --- | --- | --- |
| `pages` | `https://panappuom.github.io` | `/omochiforts/` | `User-agent: *\nAllow: /` |
| (未設定/その他) | `https://example.com` | `/` | `User-agent: *\nAllow: /` |

### GitHub Pages にデプロイする場合

```bash
DEPLOY_TARGET=pages npm run build
```

生成された `dist` を GitHub Pages に配置します。Pages 用ビルドではサイトのベースパスがリポジトリ名になります。`robots.txt` はリポジトリ配下に配置されるためインデックス制御には使えず、常に `Allow: /` を返します。検索エンジンによるインデックスを防ぎたい場合は、ルートドメインの `robots.txt` やページごとの meta タグを設定してください。

### 独自ドメインに切り替える場合

1. `astro.config.mjs` 内の `https://example.com` を実際のドメインに置き換えます。
2. `DEPLOY_TARGET` を指定せずに `npm run build` します。
3. 生成された `dist` を任意のホスティングサービスに配置します。`robots.txt` はインデックスを許可します。

`DEPLOY_TARGET` はビルド先の環境を表すための変数で、上記以外の値を指定した場合も独自ドメイン用の挙動になります。

### GitHub Actions の prod ビルド

リポジトリ変数 `ENABLE_PROD_PIPELINE`（Settings → Secrets and variables → Actions → Variables）を `true` にすると、CI でプロダクション向けビルドが有効になります。既定値は `false` です。
