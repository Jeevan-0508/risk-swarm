"""Real Laya inference, invoked as a subprocess by adapters/model-registry/laya-runtime.ts.

Reads one JSON object from stdin: {"checkpoint": str, "state": str|dict|list, "questions": dict}
(the exact shapes `laya.Agent.predict` documents). Writes one JSON object to stdout:
{"ok": true, "load_seconds": float, "infer_seconds": float, "result": <laya's real predict() output>}
or {"ok": false, "error": str} on any failure — this script never invents a result.

Kept as a separate process (not called in-process from TS) because the actual model needs
torch + transformers, which this repo's bun/TS stack does not and should not depend on; this is
the same "real runtime, isolated behind a narrow contract" shape as risk-replay's adapter talking
to a real local FastAPI backend over HTTP instead of importing its Python code directly.
"""
import json
import os
import sys
import time

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")

_AGENT_CACHE: dict = {}


def _get_agent(checkpoint: str):
    if checkpoint not in _AGENT_CACHE:
        import laya
        _AGENT_CACHE[checkpoint] = laya.load(checkpoint)
    return _AGENT_CACHE[checkpoint]


def main() -> None:
    raw_in = sys.stdin.read()
    try:
        req = json.loads(raw_in)
        checkpoint = req["checkpoint"]
        state = req["state"]
        questions = req["questions"]
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"invalid request: {e}"}))
        return

    try:
        t0 = time.time()
        agent = _get_agent(checkpoint)
        load_seconds = time.time() - t0

        t1 = time.time()
        result = agent.predict(state, questions)
        infer_seconds = time.time() - t1

        print(json.dumps({
            "ok": True,
            "load_seconds": load_seconds,
            "infer_seconds": infer_seconds,
            "result": result,
        }, default=str))
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))


if __name__ == "__main__":
    main()
