# 诡境 · 重构后的架构

## 数据与包边界

浏览器消息 → Colyseus身份/阶段校验 → GameEngine收集选择 → 剧本规则确定性裁决 → 演出描述和公开/本人投影。

- shared：仅允许跨网络的数据契约、stageId和消息名。
- game-engine：房间内阶段、普通人初始化、事件资格与带种子选择、冻结行动、演出就绪、全员已读、投影副本和终局回放。
- scenarios：JSON文案/指令模板/事件条件/2～3个选项/cue，及必要的服务端规则模块。感染、净化、门禁和结局均属于剧本，不在通用引擎写死。
- server：Colyseus房间、认证身份、请求验证、速率限制、重连票、房间清理。维持本地内存，无数据库。
- web：Vue、Pinia和Router；公共大屏、手机私人选择、演出与声音。禁止导入原始剧本或引擎。美术JSON只含表现资源。

原职业、背包和dread/power/seal/exitProgress契约已移除。状态为服务端world.facts/values和player.state，玩家已知内容独立保存在knowledge中。没有把引擎设为Colyseus自动同步Schema。

## 信息投影

PublicSnapshot只包含当前公共事件、困境、可公开的事实文字、在场玩家的提交/已读/在线状态、cue及公开后果。主持没有PrivateSnapshot。

PrivateSnapshot仅发送认证连接对应的identity知识、私人指令视图、当前选项、征兆、已知线索和本人结果。不发送player.state或InternalInstruction.data；潜伏阶段即使属于本人也不发送。选项只可根据已披露身份扩展，不能根据隐藏潜伏真相变化。

终局前ending/outcome为空，replay为空。终局才揭晓真实身份、实际行动、私人指令和带原因的状态转换。所有投影复制，客户端修改不改变服务端。

## 消息与阶段

阶段：lobby → introduction → event → action → resolution → event/ended。

- ready：玩家准备；start/reset：主持控制。
- advance {stageId}：主持在开场或事件演出完成后开放下一阶段，不能跳过行动/结果。
- presentation_done {stageId}：仅主持可报告演出完成/跳过，不直接产生游戏效果。
- action {stageId, actionId, targetId?}：认证玩家选择本事件提供的行动，最多一次。
- ack_read {stageId}：后果演出完成后本人确认，重复幂等；全员已读自动继续。
- skip_disconnected {stageId}：主持明确为未提交的离线者补本事件默认行为，或确认离线者已读。不能代操作在线者。
- sync：重连/首次绑定后读取当前投影。

stageId在每次阶段变化及重开时递增，拒绝旧阶段消息。无游戏倒计时；服务端250ms检查是否全员提交。结果先裁决再表现，动画或音效失败不能更改裁决。

## 确定性与扩展

事件先按轮次和历史事实筛选，取最高优先级，再在同级合法候选中加权随机；事件本局不重复。相同行动按有种子的稳定玩家次序处理有限资源，与消息先后无关。

新增剧本提供ScenarioDefinition：摘要、共同目标、事件配置、初始化、指令生成、可选项、回合裁决、情境说明和结局/个人解释回调。在注册表注册后，房间、二维码、阶段和页面复用。二人一幕的合成测试剧本证明不依赖旅馆、职业或感染。

配置加载时检查人数、回合、ID、权重、默认无目标行动、选项数量和cue范围。复杂规则由受信任TS模块实现；不执行JSON中的任意字符串代码。

## 恢复与生命周期

每个标签页保存各自Colyseus token；单窗口试玩的各连接使用独立Pinia和sessionStorage命名空间。断线保留180秒，旧房主持不能被新hostKey冒认。重开释放离线席位并取消旧重连票。

演出进度按roomId/stageId/cueId保存在公共浏览器sessionStorage，服务器保存演出完成位；刷新跳过已触发cue，避免重播整幕。声音只在用户手势启用后播放，失败用字幕继续。

大厅最多保留2小时，结束最多30分钟，空房清理。游戏中长期缺席需要主持明确处理，不能依靠自动超时惩罚。服务端重启会丢失所有房间，当前重构不迁移旧版本进行中的会话。
