# 印尼 TikTok Shop UGC 脚本与 Hook

## 原则

- 像真实用户发现了一个具体使用场景，而不是品牌发布会。
- 先给具体 Hook，再给品牌或品名。
- 一条视频只改变一个消费者认知、展示一个卖点、完成一个 CTA。
- 口播与画面逐句对应；不能靠口播声称画面没有证明的结果。
- 模仿爆款时提取结构，不复制原句、人物、笑点和独特镜头顺序。

## 可用结构

### Curiosity Demo

1. 首帧正在执行一个具体动作。
2. 口播邀请观众看结果。
3. 展示产品如何参与该动作。
4. 用产品特写或稳定结果收尾。

### Objection Flip

1. 用目标用户的语言说出真实顾虑。
2. 承认顾虑合理。
3. 用一次可见演示回答。
4. 给出柔和 CTA。

### Routine Fit

1. 进入一个印尼用户熟悉的日常时刻。
2. 产品自然进入流程。
3. 展示使用细节、触感或操作。
4. 回到完整产品和 CTA。

### Product-first Reveal

1. 首帧产品占据清晰视觉位置。
2. 一次镜头或手部动作揭示关键细节。
3. 结束于稳定 hero shot。

## 口播风格

使用易懂的 Bahasa Indonesia，中性口语优先。可自然使用 `cek`、`praktis`、`cocok buat`、`lihat detailnya`，但不要把每句都写成俚语。

推荐句型：

- `Kalau kamu lagi cari ...`
- `Coba lihat bagian ini ...`
- `Yang aku suka, ...` 仅用于合成达人表达可观察偏好，不伪装真实购买经历。
- `Buat dipakai sehari-hari, ini terasa ...` 只描述画面可确认的体验。
- `Lihat detailnya di TikTok Shop.`

避免：

- `Produk terbaik nomor satu`、`pasti berhasil`、`100% aman` 等绝对承诺。
- 没有证据的 `lagi diskon`、`stok tinggal sedikit`、`sudah terjual ribuan`。
- 生硬直译、过长从句、连续多个形容词。
- 虚构“我用了几天/几个月后”的真实客户经历。

## 15 秒口播检查

- 26–34 个词。
- 第一短句在前 2 秒说完。
- 每句只服务一个画面动作。
- 品名、核心卖点和 CTA 不重复堆砌。
- 朗读时保留自然停顿，不能靠超快语速塞词。

## A/B 变体

每轮最多生成三条 Prompt 方案：

- A：产品首帧 + curiosity demo。
- B：真实顾虑 + objection flip。
- C：本地日常场景 + routine fit。

保持产品、人物、卖点、时长、模型和 CTA 不变，只改变 Hook 和第一段动作。这样结果才可比较。
