# python beats.py <audio> -> tempo, first beats, and the highest-energy 16s window (start on a downbeat)
import sys, json, librosa, numpy as np
y, sr = librosa.load(sys.argv[1], sr=22050, mono=True)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units='time')
rms = librosa.feature.rms(y=y)[0]; t = librosa.times_like(rms, sr=sr)
best, bs = 0, 0
for b in beats[::4]:
    if b + 20 > len(y)/sr: break
    e = rms[(t >= b) & (t < b+16)].mean()
    if e > best: best, bs = e, b
print(json.dumps({"file": sys.argv[1], "tempo": round(float(np.atleast_1d(tempo)[0]),1), "dur": round(len(y)/sr,1),
  "best16_start": round(float(bs),2), "beats_from_best": [round(float(x-bs),3) for x in beats if bs <= x < bs+20][:60]}))
