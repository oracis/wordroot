"""wordroot edge-tts 中转服务（极简）。

本机开发： python server.py  -> 监听 http://localhost:8787
上线：    部署到任意可出网的环境（Aliyun 函数/容器），前端 options 里把中转地址改成公网 URL 即可。
浏览器扩展无法直接连 Bing 的 edge-tts WebSocket（Origin/CORS 限制），所以用这个小中转代发，零 Key、免费。

依赖： pip install flask edge-tts
"""
import asyncio
import os
import edge_tts
from flask import Flask, request, Response

app = Flask(__name__)

DEFAULT_VOICE = "en-US-JennyNeural"  # 美式女声，清晰；可换 en-US-GuyNeural 等


@app.route("/", methods=["GET"])
def health():
    return Response("wordroot tts-relay ok", mimetype="text/plain")


@app.route("/tts", methods=["POST", "OPTIONS"])
def tts():
    # 预检
    if request.method == "OPTIONS":
        return _cors(Response("", status=204))
    try:
        data = request.get_json(force=True, silent=True) or {}
    except Exception:
        data = {}
    text = (data.get("text") or "").strip()
    voice = (data.get("voice") or DEFAULT_VOICE).strip()
    if not text:
        return _cors(Response("missing text", status=400, mimetype="text/plain"))

    async def run():
        communicate = edge_tts.Communicate(text, voice)
        chunks = []
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)

    try:
        audio = asyncio.run(run())
    except Exception as e:  # 网络/协议异常，返回明文便于排查
        return _cors(Response("edge-tts error: %s" % e, status=502, mimetype="text/plain"))

    if not audio:
        return _cors(Response("empty audio", status=502, mimetype="text/plain"))

    return _cors(Response(audio, mimetype="audio/mpeg"))


def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    # 仅本机开发用；生产部署请自行加鉴权/限流，避免被滥用
    app.run(host="127.0.0.1", port=port, threaded=True)
