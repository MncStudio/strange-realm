# 《第七位访客》场景素材

2026-10-13，使用内置 image_gen 工具生成，未使用CLI或API key。素材复制到项目内，原始生成文件保留。

| 图片 | 用途 | 项目路径 |
| --- | --- | --- |
| 雾夜旅馆 | 首页、剧本卡、开场与离场结局 | apps/web/public/scenarios/seventh-visitor/hotel-night.png |
| 镜廊 | 敲门、停电、镜面、出口等事件 | apps/web/public/scenarios/seventh-visitor/mirror-corridor.png |
| 前台登记簿 | 姓名、铃声、电话、监控等事件 | apps/web/public/scenarios/seventh-visitor/reception-ledger.png |

呈现映射：apps/web/src/scenarios/seventh-visitor/art.json。新增剧本可增加同级art.json，自动发现，无需在通用场景组件内写剧情判断。图片只表达环境，不包含实际玩家姓名、身份、目标或规则裁决。

## 动效

慢速镜头推进、雾气漂移、监控扫描线、场景淡入、状态条平滑变化、低频危险提示。断电仅使画面变暗，不加入闪屏或突然人脸。顶部按钮保存本机偏好；系统prefers-reduced-motion会自动停止动画。

## 最终提示词

### 图片 1

Use case: stylized-concept. Production background art for a Chinese psychological horror browser game, StrangeRealm / The Seventh Visitor. Cinematic realistic environmental concept art, restrained analog surveillance atmosphere, fine film grain, aged material textures, ink-black and muted olive-grey palette with small dim amber lights and a single restrained red accent. Wide 16:9 composition, no people, no gore, no jumpscare face, no typography, no logos, no watermark, no UI. Real architectural proportions, ominous quiet rather than fantasy monsters. Asset type: scenario cover / opening background. Scene: an old isolated three-storey roadside inn at 2 AM in fog, wet paving leading to an entrance, a few dim windows, a faded blank signboard, the inn disappears into a dark tree line. Framing: eye-level wide exterior with building centered and generous dark negative space above; readable atmospheric silhouette. The inn is absent from every map.

### 图片 2

Use case: stylized-concept. Production background art for a Chinese psychological horror browser game, StrangeRealm / The Seventh Visitor. Cinematic realistic environmental concept art, restrained analog surveillance atmosphere, fine film grain, aged material textures, ink-black and muted olive-grey palette with small dim amber lights and a single restrained red accent. Wide 16:9 composition, no people, no gore, no jumpscare face, no typography, no logos, no watermark, no UI. Real architectural proportions, ominous quiet rather than fantasy monsters. Asset type: public event scene background. Scene: narrow old hotel corridor with peeling wallpaper, numbered door plaques are blurred and illegible, one closed door at the far end with a thin dim red light under it, tarnished wall mirror reflecting a slightly displaced empty corridor, intermittent weak ceiling lamps. Framing: one-point perspective, strong vanishing point, wide frame, deep shadows. An unsettling additional guest is suggested through the empty architecture alone.

### 图片 3

Use case: stylized-concept. Production background art for a Chinese psychological horror browser game, StrangeRealm / The Seventh Visitor. Cinematic realistic environmental concept art, restrained analog surveillance atmosphere, fine film grain, aged material textures, ink-black and muted olive-grey palette with small dim amber lights and a single restrained red accent. Wide 16:9 composition, no people, no gore, no jumpscare face, no typography, no logos, no watermark, no UI. Real architectural proportions, ominous quiet rather than fantasy monsters. Asset type: registration / clues event scene background. Scene: abandoned old hotel reception desk, open worn registration ledger with seven lines of illegible handwriting, an old brass service bell, a small copper key and weak desk lamp, analog surveillance monitor glowing softly in the background. Framing: cinematic close view at desk height, physical still life, wide frame; text must remain indistinct and unreadable, no actual names or game rules. Dust and humidity, quiet psychological dread.

