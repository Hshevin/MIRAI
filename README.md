# Figure Detection

A local, privacy-first video application that keeps one selected person visible and anonymizes every other visual pixel.

See [AGENTS.md](AGENTS.md) for architecture, invariants, and development commands.

## Development

```bash
uv sync --extra dev
uv run figure-detection-api
```

The API is available at `http://127.0.0.1:8000`; interactive documentation is at `/docs`.

