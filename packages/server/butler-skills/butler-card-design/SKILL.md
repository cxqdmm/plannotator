---
name: butler-card-design
description: >
  管家卡片的唯一写法。用 8 个固定部件拼一张卡：卡头（kicker/title/lede）、
  极淡底块（well）、进度（track）、细行（meta/tl）、选项（opt）、按钮（btn）。
  渲染器已提供全部样式（颜色、字阶、间距、圆角），你只写结构，不写样式。
  当你要向主人呈现交付结果、进展、选项、待办清单时使用。
---

# 管家卡片

**一句话：卡片不是网页，是拼图。你只从本页的部件里挑，拼成一张卡；样式渲染器全给了。**

不要在卡里写 `<style>`、不要写 `style="..."` 调颜色字号、不要发明 class 名。写了就是错。

---

## 1. 骨架（固定，照抄）

```html card
<div data-card class="flex flex-col gap-3">
  <div class="card-head">
    <p class="kicker">交付</p>
    <h2 class="title">一句话把结论说完</h2>
    <p class="lede">一到两句补充：细节、数字、下一步。</p>
  </div>

  <!-- 内容块：well / track / meta / tl / opt，任选，1~6 个 -->

  <div class="card-actions">
    <button class="btn btn-primary" data-card-confirm>主操作</button>
    <button class="btn">次要操作</button>
  </div>
</div>
```

根元素**必须**是 `data-card class="flex flex-col gap-3"`——`gap-3` 是卡片里所有块之间的呼吸。

外层边框、圆角、阴影、750 宽、**20px 内边距**都由渲染器给：**不要**在根元素上写 `p-4` / `p-5` / `px-*`——写了会变成双层内边距，内容反而窄。

---

## 2. 八个部件

### 卡头（每张卡必有）

| 部件 | 写什么 |
|---|---|
| `<p class="kicker">交付</p>` | 一个词说卡的类目：交付 / 进展 / 选择 / 提醒 / 待办。全卡只此一处。 |
| `<h2 class="title">…</h2>` | **一句结论**，不是标题名。✅「指弹版做好了」，❌「关于指弹版交付的通知」。 |
| `<p class="lede">…</p>` | 一到两句补充。可有可无；没有就删。 |

三者一起放进 `<div class="card-head">`，内部间距由它负责。

### 内容块（按内容挑，不要全用上）

**① 底块 `well`——装一条材料、一个条目**
```html
<div class="well">
  <div class="well-head">
    <span class="well-title">fingerstyle.html</span>
    <button class="well-act">打开</button>
  </div>
  <p class="well-sub">六线谱 · 点开即看即听</p>
</div>
```

**② 进度 `track`——有明确完成度时才用**
```html
<div class="track"><i style="width:62%"></i></div>
<div class="meta"><span>5 / 8 项完成</span><span class="status"><i class="dot"></i>卡在：等您裁决</span></div>
```
`track` 和 `meta` 是**一对**，紧挨着写（一个跟踪、一个说明）。

**③ 细行 `tl`——时间线中的一条**
```html
<div class="tl"><span>音色排查完毕，四件套更新</span><time>16:57</time></div>
```
多条时直接并排写，不要包容器。

**④ 选项 `opt`——单选一行**（见第 3 节交互）
```html
<button class="opt" aria-checked="true" data-value="民谣扫弦">
  <span class="opt-radio"></span>
  <span class="opt-text"><b>民谣扫弦</b><span>轻快明亮，副歌有记忆点</span></span>
</button>
```

**⑤ 按钮**
- `<button class="btn btn-primary">` 主操作，**一张卡最多一个**，通常放最后。
- `<button class="btn">` 次要操作（纯文字），可省。
- 两个一起放进 `<div class="card-actions">`。

---

## 3. 交互（先选后确认，硬性）

- 选项点击**只改本地选中态**：`aria-checked="true"`，不发消息。
- 卡片底部**一个**主按钮统一发送，带 `data-card-confirm`：

```html
<script>
  const opts = document.querySelectorAll('.opt');
  opts.forEach((o) => o.addEventListener('click', () => {
    opts.forEach((x) => x.setAttribute('aria-checked', 'false'));
    o.setAttribute('aria-checked', 'true');
  }));
  document.querySelector('[data-card-confirm]').addEventListener('click', () => {
    const picked = document.querySelector('.opt[aria-checked="true"]');
    if (!picked) return;
    plannotator.send({
      label: '选择方向',
      value: { direction: picked.dataset.value },
    });
  });
</script>
```
- 脚本写在 `data-card` 内的最后（**不要**写在根元素之外）。
- 单选一项、没有其它输入时，也可以点选项直接 `send`；**只要有多项或输入，就必须有确认按钮**。
- 建卡 / 派活 / 归档 / 停止**不在卡里做**——卡只收集意图，回话后由你走审批。

---

## 4. 文案（决定好看与否的一半）

- **标题是一句话结论**，带信息量：「功能测试，过半」「指弹版做好了」「往哪个方向收？」
- **lede 只写补充**，不要重复标题；有数字就写数字。
- 底块的 `well-sub` 写**为什么/怎么用**，不是重复文件名。
- 中文少用全角括号和顿号堆砌；一句一个意思。
- 不要 emoji、不要感叹号连发、不要「亲」「哦~」这类语气。

---

## 5. 三条硬规矩

1. **一张卡只讲一件事。** 要讲两件事就分两次回复。
2. **主按钮最多一个**，其余都退成纯文字按钮。
3. **琥珀点（`.status .dot`）全卡最多一处**，只用来标「卡在等您」。

---

## 6. 三个可以照抄的范例

### 交付结果

```html card
<div data-card class="flex flex-col gap-3">
  <div class="card-head">
    <p class="kicker">交付</p>
    <h2 class="title">《那年蝉声》指弹版</h2>
    <p class="lede">旋律与和弦写进同一份六线谱，一把吉他独奏整曲。163 个音自检无丢失，全长 2 分 06 秒。</p>
  </div>
  <div class="well">
    <div class="well-head"><span class="well-title">fingerstyle.html</span><button class="well-act">打开</button></div>
    <p class="well-sub">六线谱 · 点开即看即听</p>
  </div>
  <div class="well">
    <div class="well-head"><span class="well-title">song.tab</span><button class="well-act">打开</button></div>
    <p class="well-sub">纯文本谱 · 方便打印带去琴边</p>
  </div>
  <div class="card-actions">
    <button class="btn btn-primary">在线试听</button>
    <button class="btn">在文件夹中显示</button>
  </div>
</div>
```

### 进展

```html card
<div data-card class="flex flex-col gap-3">
  <div class="card-head">
    <p class="kicker">进展</p>
    <h2 class="title">功能测试，过半</h2>
    <p class="lede">音色排查收尾，就差您最后一道裁决。</p>
  </div>
  <div class="track"><i style="width:62%"></i></div>
  <div class="meta"><span>5 / 8 项完成</span><span class="status"><i class="dot"></i>卡在：等您裁决</span></div>
  <div class="tl"><span>音色排查完毕，四件套更新</span><time>16:57</time></div>
  <div class="tl"><span>交付 folk-melody skill</span><time>14:12</time></div>
  <div class="tl"><span>试听页上线</span><time>13:05</time></div>
  <div class="card-actions"><button class="btn">打开台账</button></div>
</div>
```

### 选择

```html card
<div data-card class="flex flex-col gap-3">
  <div class="card-head">
    <p class="kicker">选择</p>
    <h2 class="title">《那年蝉声》往哪个方向收？</h2>
    <p class="lede">三个方向我都能编，选好点一次确认即可。</p>
  </div>
  <button class="opt" aria-checked="true" data-value="民谣扫弦">
    <span class="opt-radio"></span>
    <span class="opt-text"><b>民谣扫弦</b><span>轻快明亮，副歌有记忆点</span></span>
  </button>
  <button class="opt" aria-checked="false" data-value="指弹独奏">
    <span class="opt-radio"></span>
    <span class="opt-text"><b>指弹独奏</b><span>一把吉他讲完整故事，耐听</span></span>
  </button>
  <button class="opt" aria-checked="false" data-value="双吉他">
    <span class="opt-radio"></span>
    <span class="opt-text"><b>双吉他对话</b><span>一问一答，适合现场两人</span></span>
  </button>
  <div class="card-actions"><button class="btn btn-primary" data-card-confirm>按这个方向编</button></div>
  <script>
    const opts = document.querySelectorAll('.opt');
    opts.forEach((o) => o.addEventListener('click', () => {
      opts.forEach((x) => x.setAttribute('aria-checked', 'false'));
      o.setAttribute('aria-checked', 'true');
    }));
    document.querySelector('[data-card-confirm]').addEventListener('click', () => {
      const picked = document.querySelector('.opt[aria-checked="true"]');
      if (picked) plannotator.send({ label: '确认选择', value: { direction: picked.dataset.value } });
    });
  </script>
</div>
```

---

## 7. 发布前自检

- [ ] 根元素是 `data-card class="flex flex-col gap-3"`，没有宽/边框/圆角/阴影/背景/内边距。
- [ ] 卡里没有 `<style>`、没有 `style="color:…"` 这类调色（进度条的 `width:%` 除外）。
- [ ] 没有自创 class；用到的每个 class 都在上面部件表里。
- [ ] 标题是一句结论，不是「关于…」。
- [ ] 主按钮最多一个；琥珀点最多一处。
- [ ] 多选/输入有 `data-card-confirm` 统一发送。
