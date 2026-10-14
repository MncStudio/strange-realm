# 项目协作约定

- 永远用中文回复用户；代码、技术术语和命令可保持英文。
- Git 提交作者始终为用户 Mnc，不修改 git user 配置。
- 仅用户明确要求由 Codex 提交时，在 commit message 末尾添加 `Codex`。
- 不主动 push，除非用户明确要求。
- 修改玩法先阅读 `docs/CORE_DESIGN_PRINCIPLES.md`、`docs/REFACTOR_PLAN.md` 和 `docs/GAME_DESIGN.md`，按此优先级执行；更新机制后同步文档与测试结论。
- 当前版本为普通人开局、动态私人指令与感染异变，不恢复旧职业、背包或四条资源经营；旧文档归档不作当前规范。
- 公共客户端不能导入剧本秘密配置或原始引擎状态。所有行为必须由服务端校验和结算。
