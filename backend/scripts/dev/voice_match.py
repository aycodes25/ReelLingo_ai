"""Developer tool: how much does the dubbed voice sound like the original speaker?

Usage: python voice_match.py original.wav dubbed.wav

Cuts both recordings into 3-second pieces, turns each into a speaker "fingerprint" (SpeechBrain ECAPA, runs on this
computer), and reports the cosine similarity between the original speaker and the dub. As a guide: the same person across
recordings is usually 0.55-0.80; a different person is usually below 0.30. Needs: pip install speechbrain
"""
import sys
import numpy as np
import torch
from scipy.io import wavfile

original_path, dubbed_path = sys.argv[1], sys.argv[2]
from speechbrain.inference.speaker import EncoderClassifier
from speechbrain.utils.fetching import LocalStrategy

model = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb", savedir="pretrained_ecapa", run_opts={"device": "cpu"}, local_strategy=LocalStrategy.COPY)  # copy, not link: Windows needs special rights for links


def pieces(path, seconds=3.0, min_energy=0.01):
    # Expects a 16 kHz mono WAV (make one with: ffmpeg -i video.mp4 -vn -ac 1 -ar 16000 out.wav)
    rate, data = wavfile.read(path)
    if rate != 16000:
        raise SystemExit(f"{path} must be 16 kHz (it is {rate} Hz)")
    wav = torch.from_numpy(data.astype(np.float32) / 32768.0).unsqueeze(0)
    size = int(16000 * seconds)
    out = []
    for start in range(0, wav.shape[1] - size, size):
        piece = wav[:, start:start + size]
        if piece.pow(2).mean().sqrt() > min_energy:  # skip near-silence
            out.append(piece)
    return out


def embed(items):
    with torch.no_grad():
        return torch.nn.functional.normalize(torch.cat([model.encode_batch(item).squeeze(1) for item in items]), dim=1)


original, dubbed = embed(pieces(original_path)), embed(pieces(dubbed_path))
centre = torch.nn.functional.normalize(original.mean(dim=0, keepdim=True), dim=1)
against_original = (dubbed @ centre.T).squeeze(1).numpy()
within_original = (original @ centre.T).squeeze(1).numpy()
print(f"original pieces: {len(original)}, dubbed pieces: {len(dubbed)}")
print(f"original vs its own average voice (how consistent the original is): mean {within_original.mean():.2f}")
print(f"dubbed vs original speaker: mean {against_original.mean():.2f}, median {np.median(against_original):.2f}, "
      f"share above 0.50: {(against_original > 0.5).mean() * 100:.0f}%")
