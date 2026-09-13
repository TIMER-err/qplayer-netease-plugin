# QPlayer 网易云音源插件

<p><b>简体中文</b> · <a href="README.en.md">English</a></p>

QPlayer 的独立音源插件，由用户自行安装。它实现公开的 QPlayer JavaScript 插件 ABI，
把网易云相关的接口地址、请求变换、登录处理与凭据全部留在 QPlayer 核心之外。

本项目与网易云音乐没有隶属、合作或背书关系，不分发音频、账号凭据或受版权保护的媒体
内容。使用者需自行遵守服务条款与当地法律。

## 功能

通过 QPlayer 基于能力声明的 ABI 提供：

- 搜索（歌曲、专辑、歌手）与热搜关键词
- 首页推荐：每日推荐歌曲、推荐歌单，以及按官方分组返回的歌单分区（雷达歌单、
  专属场景歌单等）
- 歌曲、歌单、专辑、歌手详情
- 播放地址解析与歌词（含 AMLL 提供的 TTML 逐字歌词）
- 登录、账号信息、最近播放、红心与歌单增删改、更换歌单封面、听歌打卡、心动模式、分享

两个插件自有的入口，由插件声明、QPlayer 渲染：

- **一起听**（播放页入口）——房间协议、同步策略、主控权与提示全部实现在本插件内，
  QPlayer 只提供通用的播放、队列、剪贴板与提示服务。
- **音源解锁**（设置页开关）——歌曲在网易云不可播放时，尝试从其他来源匹配播放地址。

登录凭据只通过 QPlayer 按插件隔离的加密凭据库保存。

完整的 ABI 与包格式见
[QPlayer 插件模板](https://github.com/TIMER-err/qplayer-plugin-template/blob/main/docs/ABI.md)。

## 构建

生成未签名的开发包：

```bash
chmod +x scripts/package.sh
./scripts/package.sh
python3 scripts/verify-package.py dist/*.qplug
```

手动导入未受信任的包时，QPlayer 会显示代码执行警告。

正式版本使用发布者的 P-256 私钥签名，私钥保存在仓库之外，通常位于发布工作流的
Secret 中：

```bash
QPLAYER_PLUGIN_SIGNING_KEY=/secure/path/publisher-private.pem ./scripts/package.sh
```

`publisher-key.pub` 是对应的公钥。QPlayer 将其固定在程序内，因此不能更换：更换发布者
密钥会使所有已发布版本的 QPlayer 无法安装本插件。发布工作流会拒绝使用与该文件不匹配
的私钥签名。

## 发布

推送与 `plugin.json` 版本一致的 `v<version>` tag 即触发发布工作流，自动签名、校验并
创建 GitHub Release。QPlayer 从本仓库的 latest release 读取可安装版本，因此 Release
中必须恰好挂载一个 `.qplug`，且不能是草稿或预发布。

本插件独立分发，不由 QPlayer 捆绑或托管。网易云音乐为其权利人的商标。
