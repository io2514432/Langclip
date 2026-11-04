"""채점 상수 회귀 테스트 (황금 테스트)

목적: librosa/numpy 를 올렸을 때 채점 점수가 조용히 망가지지 않게 한다.
2026-11-04 이전에는 이 테스트가 없어서, 라이브러리 업그레이드로 피치·음색이
40점/7점으로 떨어진 것을 아무도 몰랐다.

사용법:  python test_golden.py
"""
import numpy as np
import engine

SR = 16000


def synth(dur=2.6, f0=140.0, seed=0):
    """사람 목소리에 가까운 합성 신호 (기본주파수 + 배음 + 진폭 변조)."""
    t = np.arange(int(dur * SR)) / SR
    y = sum((0.6 ** k) * np.sin(2 * np.pi * f0 * (k + 1) * t) for k in range(6))
    y = y * (1 + 0.35 * np.sin(2 * np.pi * 3.1 * t))
    y = y + 0.02 * np.random.default_rng(seed).standard_normal(t.size)
    env = np.minimum(1, t / 0.08) * np.minimum(1, (dur - t) / 0.12)
    return (y * env * 0.3).astype(np.float32)


def shifted(y, semitones):
    import librosa
    ratio = 2 ** (semitones / 12.0)
    z = librosa.resample(y, orig_sr=int(SR * ratio), target_sr=SR)
    return z[:y.size] if z.size >= y.size else np.pad(z, (0, y.size - z.size)).astype(np.float32)


def main():
    import librosa
    ref = synth()
    ok = 0

    s = engine.score(ref, ref)
    assert s["total"] >= 97 and s["pitch"] >= 95 and s["timbre"] >= 95, s
    print(f"  ✓ 동일 신호            total={s['total']} (pitch={s['pitch']} timbre={s['timbre']})")
    ok += 1

    noisy = ref + 0.002 * np.random.default_rng(1).standard_normal(ref.size).astype(np.float32)
    s_noisy = engine.score(ref, noisy)
    assert s_noisy["total"] > 80, s_noisy
    print(f"  ✓ 들리지 않는 잡음만    total={s_noisy['total']} (이전 상수에서는 36.5 였음)")
    ok += 1

    s_pitch = engine.score(ref, shifted(ref, 1.8))
    assert 45 < s_pitch["total"] < 92, s_pitch
    print(f"  ✓ 피치 +1.8반음         total={s_pitch['total']} (pitch={s_pitch['pitch']})")
    ok += 1

    # 순서 보존: 동일 > 잡음 > 피치 어긋남
    assert s["total"] > s_noisy["total"] > s_pitch["total"], (s["total"], s_noisy["total"], s_pitch["total"])
    print("  ✓ 순서 보존            동일 > 잡음 > 피치 어긋남")
    ok += 1

    # 음량 불변: 크게/작게 녹음해도 점수가 같아야 한다
    quiet = (ref * 0.25).astype(np.float32)
    loud = (ref * 2.0).astype(np.float32)   # 클리핑이 생기면 왜곡이므로 2배까지만
    s_q, s_l = engine.score(ref, quiet), engine.score(ref, loud)
    assert abs(s_q["total"] - s_l["total"]) < 6, (s_q["total"], s_l["total"])
    print(f"  ✓ 음량 불변            작게={s_q['total']} 크게={s_l['total']}")
    ok += 1

    # 상수 자체를 고정: K 값이 실수로 바뀌면 여기서 걸린다
    assert abs(engine.K_PITCH - 3.10) < 1e-6 and abs(engine.K_TIMBRE - 14.30) < 1e-6, (
        engine.K_PITCH, engine.K_TIMBRE)
    print(f"  ✓ 보정 상수 고정        K_PITCH={engine.K_PITCH} K_TIMBRE={engine.K_TIMBRE}")
    ok += 1

    print()
    print(f"채점 회귀 테스트 {ok}개 항목 통과  (librosa {librosa.__version__})")


if __name__ == "__main__":
    main()
