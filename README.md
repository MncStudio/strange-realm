# 诡境 · StrangeRealm

电脑主持、手机秘密选择、现实朋友面对面交流的局域网恐怖故事游戏。4～6人普通访客开局，私人怪谈指令和实际行动逐渐改变故事与身份；异变后仍可选择抵抗或合作。

当前剧本《第七位访客》：7幕、12个条件事件、每幕2～3个情境选择、4类结局与真实因果回放。平台与剧本分离，不包含固定职业、背包经营或资源条操作。

## Mac安装与启动

需要Node.js 22+、pnpm 10。未安装pnpm可运行 `npm install -g pnpm@10.10.0`。

```bash
cd /Users/mnc/Documents/strange-realm
pnpm install
pnpm dev
```

电脑打开 `http://localhost:5173`。前端监听0.0.0.0:5173，服务端HTTP/WebSocket监听0.0.0.0:2567。Ctrl+C停止。

此版本更换了游戏协议。旧试玩或旧房间应先关闭并重启前后端，新开一局；内存房间没有跨重启存档。

## 只用一个窗口试玩

```bash
pnpm demo
```

自动启动独立服务（5185/2589），加入你和3位自动同伴。公共故事在左边，你的私人手机在右边。没有其他玩家窗口。

1. 点击开始，所有人都是普通访客。
2. 看大屏事件，点击开始讨论与选择；可采用上方建议，也可在右侧手动选择。其余同伴会提交自己的行动。
3. 全员选完自动结算。看公共后果和自己的结果，点击已读；同伴也确认后自动进入下一幕。
4. 第七幕之后揭晓实际选择、指令、感染和结局；同页重新开始。

`pnpm demo -- --players=6` 模拟六人。`pnpm demo -- --smoke` 自动检查完整单窗口流程；关闭窗口或Ctrl+C退出。默认端口占用时先关闭旧试玩，也可用SR_DEMO_WEB_PORT和SR_DEMO_SERVER_PORT指定独立端口。

没有本机Chrome时先运行 `pnpm exec playwright install chromium`。试玩页仅在开发测试环境注册，不进入生产构建。

## 手机局域网加入

1. Mac和手机接入同一Wi-Fi。
2. 电脑创建房间，选择剧本。电脑不占玩家名额。
3. 大厅显示局域网地址和二维码；多网卡/VPN时可修改成正确IP。
4. 玩家扫码设置昵称，或者访问 `http://Mac的局域网IP:5173` 输入六位房间码。
5. 全员准备后电脑开始主持；至少4名玩家，最多6名。

可用 `ipconfig getifaddr en0` 查Wi-Fi地址。macOS防火墙允许Node访问局域网，确保路由器没有AP隔离且5173/2567可访问。普通手机联机使用pnpm dev，不使用自动同伴试玩入口。

## 本局怎么玩

电脑展示“发生了什么”和当前困境；手机只显示当前选择、收到的私人指令和已经知道的情况。可以现实中坦白、撒谎、合作或拒绝。系统不监听对话，只按实际行动裁决。

没有讨论/行动倒计时。全员提交统一结算，公共后果播放后，每人点已读自动继续。主持不能跳过在线者；离线未提交者可由主持明确补默认行为，离线本身不会感染。

潜伏感染的真实阶段不会发送给本人，征兆也不等于确定感染。觉醒和异变时明确告知已知变化，并保留帮助、抵抗、净化的选择。机会和后果以当前事件说明为准。

公共声音需电脑点击“启用现场声音”，可调音量或静音；被浏览器阻止时字幕仍能继续。动效可关闭并尊重系统减少动态设置。当前声音为本地合成短音效，尚无完整配音。

## 检查

```bash
pnpm check                 # 类型检查、单元测试、构建、六人协议验收
pnpm test:browser          # 四个模拟手机与公共浏览器的完整七幕
pnpm demo -- --smoke       # 单窗口、手动选择、已读、结局、重开与刷新
pnpm demo -- --smoke --players=6
```

各脚本启动并清理自己的独立服务，不需提前运行pnpm dev。截图位于test-results/。测试覆盖权限与隐藏真相、普通人开局、指令、感染/护持/净化、全员提交及已读、乱序确定性、四类结局、重连与房间清理；当前数量以pnpm test输出为准。

## 结构与后续开发

- apps/web：Vue 3、Vite、Pinia、Router、手机与公共演出。
- apps/server：Colyseus房间、权限、输入校验和重连。
- packages/shared：允许跨网络的投影与消息契约。
- packages/game-engine：通用阶段、事件、提交、已读和确定性回放。
- packages/scenarios：服务端JSON与必要规则模块；不被前端导入。

修改前先读 [核心原则](docs/CORE_DESIGN_PRINCIPLES.md)、[重构计划](docs/REFACTOR_PLAN.md)、[当前玩法](docs/GAME_DESIGN.md)与[架构](docs/ARCHITECTURE.md)。事件表见[SCENARIO_EVENTS.md](docs/SCENARIO_EVENTS.md)，真人验收用[PLAYTEST.md](docs/PLAYTEST.md)。结局可在电脑保存本局故事回放，便于记录实际选择与问题。旧职业版说明在docs/archive，仅作历史参考。

生产构建后在两个终端运行：

```bash
pnpm --filter @strange-realm/server start
pnpm --filter @strange-realm/web exec vite preview --host 0.0.0.0 --port 5173
```

目前无数据库、注册、AI裁决、付费或Three.js。实体手机和真人4/6人聚会实玩仍需验证，自动化不代表恐怖氛围与讨论质量已经成熟。未实现完整配音、持久化存档及跨设备恢复；停止服务会清空房间。
