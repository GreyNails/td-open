# 不需要密钥的 API 接入演练

这些示例用于学习如何填写连接配置、发送请求和把返回资源交给节点。演练服务返回程序制作的测试素材，**不是 AI 生成**，不会调用外部接口或收费服务。

所有命令从仓库根目录执行。先完成主 README 的依赖安装。

## 1. 启动演练服务

第一个终端：

```bash
.venv/bin/python examples/api/mock_provider.py --port 9010
```

服务只监听 `127.0.0.1:9010`。打开 `http://127.0.0.1:9010/docs` 可以查看演练接口。

## 2. 启动隔离的 TD Open

第二个终端：

```bash
TD_PORT=8766 TD_DATA_DIR=.cache/api-guide-demo ./scripts/start.sh
```

打开 `http://127.0.0.1:8766`。演练作品、配置和返回素材保存在本项目的 `.cache/api-guide-demo`，与默认 `data` 目录分开。远程服务器需要把 `8766` 转发到自己的电脑；`9010` 是后端使用的地址，通常不需要转发。

## 3. 保存四份连接

第三个终端：

```bash
for capability in text image music 3d; do
  curl --fail-with-body http://127.0.0.1:8766/api/providers \
    -H 'Content-Type: application/json' \
    --data-binary @examples/api/demo-$capability.provider.json
done
```

| 配置 | 协议 | 返回结果 |
| --- | --- | --- |
| [demo-text.provider.json](demo-text.provider.json) | OpenAI 兼容 `/v1/chat/completions` | 明确标注非 AI 的文字回声 |
| [demo-image.provider.json](demo-image.provider.json) | OpenAI 兼容 `/v1/images/generations` | PNG 渐变图 |
| [demo-music.provider.json](demo-music.provider.json) | 自定义 HTTP `/generate/music` | 一秒 440 Hz WAV 测试音 |
| [demo-3d.provider.json](demo-3d.provider.json) | 自定义 HTTP `/generate/3d` | 可解析的三角形 GLB 模型 |

刷新隔离工作台，在“连接”中查看服务。添加对应的 AI 节点，在参数区选中演练服务，填写提示词并点击手动运行。图片、音乐和 3D 会写入“生成资源地址”，文字会写入“生成文字”。各类节点如何连接、音乐如何播放和模型如何预览，见 [完整 AI 接入教程](../../docs/AI_API.md)。

也可以先用 HTTP 验证：

```bash
curl --fail-with-body http://127.0.0.1:8766/api/ai/generate \
  -H 'Content-Type: application/json' \
  --data '{"provider_id":"demo-image","capability":"image","prompt":"测试连接"}'
```

成功时，响应的 `url` 指向 `/api/assets/...png`。把它接在 `http://127.0.0.1:8766` 后面即可查看。服务返回的 `data.demo` 为 `true`，方便区分演练数据。

## 换成真实供应商或 MCP

在连接中心新建服务，按照供应商文档填写真实地址、模型、密钥和请求模板。这里的测试接口不能证明某个供应商已兼容。完整字段说明、异步任务限制和排错方法见 [AI 服务](../../docs/AI_API.md)。

[mcp-client.json.example](mcp-client.json.example) 是外部 AI 客户端启动 TD Open stdio MCP 的配置模板，需要替换本机 Python 路径并先启动应用。双向接入、工具白名单和 SSH 场景见 [MCP 教程](../../docs/MCP_GUIDE.md)。

结束时在两个服务终端分别按 `Ctrl+C`。测试产生的配置和素材会保留在项目内，可以下次继续使用。
