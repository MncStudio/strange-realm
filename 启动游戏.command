#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22 或更新版本：https://nodejs.org/"
  read -k 1 "?按任意键关闭。"
  exit 1
fi
if ! node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'; then
  echo "需要 Node.js 22 或更新版本。"
  read -k 1 "?按任意键关闭。"
  exit 1
fi
if [[ ! -f node_modules/qrcode/package.json ]]; then
  echo "首次运行，正在安装游戏所需的小组件…"
  if ! npm install --omit=dev; then
    echo "安装未完成，请检查网络后重试。"
    read -k 1 "?按任意键关闭。"
    exit 1
  fi
fi
node server.mjs --open
read -k 1 "?游戏服务已停止。按任意键关闭。"
