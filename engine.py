"""셰도잉 음향 유사도 채점 엔진 (Acoustic Similarity Scorer) v3
- Mimic Party 방식: 피치 / 리듬 / 음색 / 어택 4축 채점, 0~100점
"""
import numpy as np
import librosa

SR, HOP, N_FFT = 16000, 160, 1024        # 16kHz, 10ms 프레임

# ---- 캘리브레이션 상수 (지수 감쇠 스케일) -------------------------------
K_PITCH = 0.75      # 반음 RMS 오차 -> 점수
K_TIMBRE = 1.80     # CMVN-MFCC RMS 거리 -> 점수
W_VOICED = 0.30     # 피치 점수에 곱하는 "유성음 비율 유사도" 최소 가중치


# ================================================== 1) 전처리
def _norm(y):
    p = float(np.max(np.abs(y))) if y.size else 0.0
    if p < 1e-4:
        raise ValueError("무음 또는 너무 조용한 입력입니다")
    return (y / p).astype(np.float32)


def _frame_trim(y, sr=SR, rel=0.03):
    rms = librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]
    idx = np.flatnonzero(rms > max(float(rms.max()) * rel, 1e-4))
    if idx.size == 0:
        raise ValueError("무음")
    s = max(0, idx[0] * HOP - HOP)
    e = min(len(y), (idx[-1] + 1) * HOP + HOP)
    return y[s:e]


def preprocess(y, sr=SR):
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)                       # 스테레오 -> 모노
    y = _norm(y)
    # ★ trim의 hop을 특징 hop과 맞춰야 경계 오차가 32ms -> 10ms로 줄어든다
    y, _ = librosa.effects.trim(y, top_db=30, frame_length=N_FFT, hop_length=HOP)
    y = _frame_trim(y, sr)
    if y.size < int(0.2 * sr):
        raise ValueError("0.2초 미만의 너무 짧은 입력입니다")
    return _norm(y)


def _raw_logrms(y):
    r = librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]
    return np.log(r + 1e-6)


def align_lag(y_ref, y_take, max_ms=400):
    """테이크의 앞부분 지연을 프레임 단위 상호상관으로 보정"""
    e1, e2 = _raw_logrms(y_ref), _raw_logrms(y_take)
    n = min(e1.size, e2.size)
    max_lag = int(max_ms / 1000 * SR / HOP)
    best, bl = -2.0, 0
    for L in range(-max_lag, max_lag + 1):
        if L >= 0:
            a, b = e1[:n - L], e2[L:n]
        else:
            a, b = e1[-L:n], e2[:n + L]
        if a.size < 10:
            continue
        if a.std() < 1e-9 or b.std() < 1e-9:
            continue
        c = float(np.corrcoef(a, b)[0, 1])
        if c > best:
            best, bl = c, L
    shift = bl * HOP
    if shift > 0:                                # 테이크가 늦음 -> 앞을 잘라냄
        y_take = y_take[shift:]
    elif shift < 0:                              # 테이크가 빠름 -> 앞을 0으로 채움
        y_take = np.pad(y_take, (-shift, 0))
    return y_take, shift / SR


# ================================================== 2) 특징 추출
def cmvn(X, eps=1e-5):
    X = np.asarray(X, float)
    return (X - X.mean(axis=-1, keepdims=True)) / (X.std(axis=-1, keepdims=True) + eps)


def _mfcc(y, sr=SR):
    m = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20, n_fft=N_FFT, hop_length=HOP)[1:]
    m = cmvn(m)
    k = np.ones(3) / 3.0                          # ★ 3프레임 이동평균: 1~2프레임 오차 둔감화
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 1, m)


def extract(y, sr=SR):
    f0, voiced, _ = librosa.pyin(y=y, fmin=65.0, fmax=1200.0, sr=sr,
                                 frame_length=N_FFT, hop_length=HOP)
    voiced = np.asarray(voiced, bool)
    v_ratio = float(voiced.mean()) if voiced.size else 0.0
    T = f0.shape[0]
    f0i = np.where(voiced, f0, np.nan).astype(float)
    if voiced.any():
        idx, good = np.arange(T), ~np.isnan(f0i)
        f0i = np.interp(idx, idx[good], f0i[good])
        semi = 12.0 * np.log2(f0i / 440.0)
        med = float(np.median(semi))
        semi = semi - med                        # ★ 화자 음역대(전조) 보정
    else:
        semi, med = np.zeros(T), 0.0

    mfcc = _mfcc(y)
    rms = librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]
    n = min(semi.size, mfcc.shape[1], rms.size)
    return {
        "pitch": semi[:n],
        "mfcc": mfcc[:, :n],
        "env": cmvn(np.log(rms[:n] + 1e-6)),
        "v_ratio": v_ratio,
        "f0_med": med,
        "dur": n * HOP / sr,
    }


# ================================================== 3) DTW (Sakoe-Chiba 밴드)
def dtw(A, B, band_ratio=0.25, cap=None):
    A, B = np.asarray(A, float), np.asarray(B, float)
    if A.ndim == 1:
        A = A[:, None]
    if B.ndim == 1:
        B = B[:, None]
    Ta, Tb = A.shape[0], B.shape[0]
    band = int(np.ceil(max(band_ratio * max(Ta, Tb), abs(Ta - Tb)))) + 1
    INF = 1e18
    C = np.full((Ta, Tb), INF)
    for i in range(Ta):
        c = i * (Tb - 1) / max(Ta - 1, 1)
        lo, hi = max(0, int(c - band)), min(Tb, int(c + band) + 1)
        d = np.sum((A[i][None, :] - B[lo:hi, :]) ** 2, axis=1)
        if cap is not None:
            d = np.minimum(d, cap * cap)
        C[i, lo:hi] = d
    acc = np.full((Ta, Tb), INF)
    back = np.zeros((Ta, Tb), np.int8)
    acc[0, 0] = C[0, 0]
    for i in range(Ta):
        for j in range(Tb):
            if i == 0 and j == 0 or C[i, j] >= INF:
                continue
            best, arg = INF, -1
            if i and acc[i - 1, j] < best:
                best, arg = acc[i - 1, j], 0
            if j and acc[i, j - 1] < best:
                best, arg = acc[i, j - 1], 1
            if i and j and acc[i - 1, j - 1] < best:
                best, arg = acc[i - 1, j - 1], 2
            if arg >= 0:
                acc[i, j] = C[i, j] + best
                back[i, j] = arg
    if acc[Ta - 1, Tb - 1] >= INF:
        return float("inf"), []
    path, i, j = [], Ta - 1, Tb - 1
    while True:
        path.append((i, j))
        if i == 0 and j == 0:
            break
        b = back[i, j]
        i -= int(b in (0, 2))
        j -= int(b in (1, 2))
    path.reverse()
    return float(acc[Ta - 1, Tb - 1]) / len(path), path


# ================================================== 4) 원시 지표
def raw_metrics(y_ref, y_take, sr=SR, pitch_norm_timbre=True):
    ref = extract(preprocess(y_ref, sr), sr)
    take_audio, lag = align_lag(preprocess(y_ref, sr), preprocess(y_take, sr))
    take = extract(take_audio, sr)

    # --- 마스터 정렬: 음색 특징 기준 ---
    mfcc_d, path = dtw(ref["mfcc"].T, take["mfcc"].T, 0.25)
    ia = np.array([p[0] for p in path])
    ib = np.array([p[1] for p in path])

    # --- 피치 (반음 단위, 전조 허용) ---
    pitch_d, _ = dtw(ref["pitch"], take["pitch"], 0.30, cap=12.0)
    has_pitch = ref["v_ratio"] > 0.15 and take["v_ratio"] > 0.15
    v_sim = (min(ref["v_ratio"], take["v_ratio"]) / max(ref["v_ratio"], take["v_ratio"])
             if max(ref["v_ratio"], take["v_ratio"]) > 0 else 0.0)

    # --- 리듬 ---
    ea, eb = ref["env"][ia], take["env"][ib]
    env_corr = 0.0 if ea.std() < 1e-9 or eb.std() < 1e-9 else float(np.corrcoef(ea, eb)[0, 1])
    dur_ratio = take["dur"] / max(ref["dur"], 1e-6)
    timing = 1.0 - min(1.0, abs(np.log(max(dur_ratio, 1e-6))) / np.log(2.0))
    slope = float(np.polyfit(ia, ib, 1)[0]) if ia.size > 2 else 1.0
    slope_pen = float(np.exp(-abs(np.log(max(abs(slope), 1e-6))) / 0.45))

    # --- 음색: 음역대 보정 MFCC (테이크를 기준 피치로 리샘플) ---
    if pitch_norm_timbre and has_pitch and abs(take["f0_med"] - ref["f0_med"]) > 0.5:
        ratio = 2 ** ((take["f0_med"] - ref["f0_med"]) / 12.0)
        tgt = int(round(sr * ratio))
        if 4000 < tgt < 64000:
            tn = librosa.resample(take_audio, orig_sr=sr, target_sr=tgt)
            m2 = _mfcc(tn, sr)
            n = min(ref["mfcc"].shape[1], m2.shape[1])
            mfcc_d, _ = dtw(ref["mfcc"][:, :n].T, m2[:, :n].T, 0.25)

    return {
        "pitch_d": float(np.sqrt(max(pitch_d, 0.0))),     # 반음 RMS 오차
        "timbre_d": float(np.sqrt(max(mfcc_d, 0.0))),     # CMVN-MFCC RMS 거리
        "env_corr": max(0.0, env_corr),
        "timing": float(timing),
        "slope": slope,
        "slope_pen": slope_pen,
        "v_sim": v_sim,
        "has_pitch": has_pitch,
        "v_ratios": [round(ref["v_ratio"], 3), round(take["v_ratio"], 3)],
        "f0_med": [round(ref["f0_med"], 2), round(take["f0_med"], 2)],
        "durs": [round(ref["dur"], 2), round(take["dur"], 2)],
        "lag_applied_s": round(lag, 3),
    }


# ================================================== 5) 점수화
def score(y_ref, y_take, sr=SR):
    m = raw_metrics(y_ref, y_take, sr)
    pitch = 100.0 * np.exp(-m["pitch_d"] / K_PITCH)
    if m["has_pitch"]:
        pitch *= (W_VOICED + (1 - W_VOICED) * m["v_sim"])
    else:
        pitch = 0.0
    timbre = 100.0 * np.exp(-m["timbre_d"] / K_TIMBRE)
    rhythm = 100.0 * np.clip(0.50 * m["env_corr"] + 0.25 * m["timing"]
                             + 0.25 * m["slope_pen"], 0, 1)
    attack = 100.0 * max(0.0, m["env_corr"])

    if m["has_pitch"]:
        w = {"pitch": 0.40, "rhythm": 0.28, "timbre": 0.22, "attack": 0.10}
    else:                                   # 박수/속삭임/동물소리 등 비유성음
        w = {"pitch": 0.00, "rhythm": 0.42, "timbre": 0.40, "attack": 0.18}
    total = (w["pitch"] * pitch + w["rhythm"] * rhythm
             + w["timbre"] * timbre + w["attack"] * attack)
    return {
        "total": round(float(total), 1),
        "pitch": round(float(pitch), 1),
        "rhythm": round(float(rhythm), 1),
        "timbre": round(float(timbre), 1),
        "attack": round(float(attack), 1),
        "has_pitch": m["has_pitch"],
        "weights": w,
        "raw": {k: (round(v, 3) if isinstance(v, float) else v)
                for k, v in m.items()},
    }
