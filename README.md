# magpie-claude-zh-silent

给 [magpie](https://github.com/yetone/magpie) 的插件：让 Windows 上的 Claude 桌面版（3p Gateway 模式）**静默**加载官方中文语言包。

它是 [`magpie-claude-zh`](https://github.com/jk-uzi/claude-desktop-zh-win) 的静默替代加载器。原插件通过「弹 DevTools 窗口 + 文件选择框 + 模拟按键」把语言包送进页面，每次注入都会弹出窗口并抢焦点；本插件改用 Claude 自带的 DevTools 协议（仅 127.0.0.1）直接把语言包送进 `app://localhost` 页面，全程没有窗口、没有对话框、不碰键盘焦点。

## 它解决什么

- **不弹窗**：没有 DevTools 窗口、没有文件选择框、不模拟按键。
- **自动注入**：Claude 启动后自动等待页面就绪并注入，插件宿主重启也能继续等。
- **Claude 更新后仍可用**：语言包按当前安装的 Claude 版本现场构建，不写死路径或版本。

## 前置条件

1. Windows 10/11，Claude 桌面版为 Microsoft Store（MSIX）安装包。
2. magpie 里**已安装并保留** `github:jk-uzi/claude-desktop-zh-win`。本插件只调用它的语言包发现与构建库，不复制、不再分发官方语言包。
3. Claude 的 `developer_settings.json` 里 `allowDevTools` 为 `true`（原插件安装时已处理）。

## 安装

在 magpie 插件页添加：

```text
github:Aw999Lab/magpie-claude-zh-silent
```

插件没有 npm 依赖，不需要额外权限。

## 使用

### 方式一：让插件启动 Claude（推荐）

对 magpie 说「用静默方式启动 Claude 中文版」或直接调用工具 `claude_zh_silent_launch`，它会：

1. 以 `--remote-debugging-port=9333 --remote-debugging-address=127.0.0.1` 启动 Claude（无控制台窗口）；
2. 轮询等 `app://localhost` 页面出现；
3. 构建语言包并通过 DevTools 协议注入；
4. 返回 `applied` / `already` / `timeout` / `not-acknowledged` / `claude-exited` 等状态。

### 方式二：桌面快捷方式

在插件页勾选「自动注入」后，自己建一个 Claude 快捷方式，目标后面加两个参数：

```text
"C:\Program Files\WindowsApps\Claude_<版本>_x64__pzs8sxrjxfjjc\app\Claude.exe" --remote-debugging-port=9333 --remote-debugging-address=127.0.0.1
```

Claude 起来后插件会自动检测端口并注入，不需要再调用工具。

### 选项

| 键 | 默认 | 说明 |
|---|---|---|
| `locale` | `zh-Hans` | `zh-Hans` 简体 / `zh-Hant` 繁体 |
| `runtimeAutoLoad` | `true` | 插件加载时后台等待带调试端口的 Claude 出现并自动注入 |
| `port` | `9333` | DevTools 端口，须与 Claude 启动参数一致 |

`claude_zh_silent_status` 可随时查看最近一次注入结果。

## 与原插件共存的建议

原插件的 `runtimeAutoLoad`（自动注入）同样会弹 DevTools 窗口。确认本插件工作正常后，建议在原插件设置页**关闭**它的自动注入，保留本插件的即可；原插件的安装 / 切换 / 恢复功能不受影响。

## 安全说明

- 调试端口只绑定 `127.0.0.1`，本插件也只连接 `ws://127.0.0.1` 地址，不接受外部主机。
- 开着调试端口意味着本机任何进程都能控制 Claude 页面。只在可信电脑上使用，用完可以正常退出 Claude（端口随之关闭）。
- 本插件不修改 Claude 安装目录、不改语言包、不读取账号数据。

## 已知限制

- 仅支持 Windows + MSIX 版 Claude；macOS 或解压版不适用。
- 注入是进程级的：Claude 重启后语言包需要重新注入（插件会自动等待并完成））。
- **尚未在真实 Claude 进程上完成一次端到端验证**（截至 0.1.0）：离线构建、协议连接与前端页面定位均已验证，但完整链路还需一次实际启动观察。遇到 `not-acknowledged` 时请把 `claude_zh_silent_status` 的结果发给我。

## 致谢

语言包发现、构建与运行时全部来自 [`magpie-claude-zh`](https://github.com/jk-uzi/claude-desktop-zh-win)（MIT），官方中文语言包版权归 Anthropic。详见 [NOTICE](NOTICE)。
