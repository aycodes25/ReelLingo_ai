from fastapi import FastAPI

app = FastAPI(title="ReelLingo API")


@app.get("/health")
def health():
    return {"status": "ok"}
