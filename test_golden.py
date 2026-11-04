"""채점 엔진 회귀 테스트 (황금 테스트)

목적: 엔진을 고치거나 라이브러리를 올렸을 때 점수가 조용히 망가지지 않게 한다.
핵심은 '절대 점수'가 아니라 **순서**다. 열화가 커질수록 점수가 단조 감소해야 한다.

사용법:  python test_golden.py
"""
import numpy as np
import engine

SR = 16000


def synth(dur=2.4, f0=150.0, seed=0):
    t = np.arange(int(dur * SR)) / SR
    y = sum((0.6 ** k) * np.sin(2 * np.pi * f0 * (k + 1) * t) for k in range(6))
    y = y * (1 + 0.45 * np.sin(2 * np.pi * 3.0 * t))
    y = y + 0.02 * np.random.default_rng(seed).standard_normal(t.size)
    env = np.minimum(1, t / 0.06) * np.minimum(1, (dur - t) / 0.10)
    return (y * env * 0.3).astype(np.float32)


def shift(y, semi):
    r = 2 ** (semi / 12.0)
    z = engine.librosa.resample(y, orig_sr=int(SR * r), target_sr=SR)
    return z[:y.size] if z.size >= y.size else np.pad(z, (0, y.size - z.size)).astype(np.float32)


def slow(y, f):
    return engine.librosa.resample(y, orig_sr=SR, target_sr=int(SR * f))


def main():
    import librosa
    ref = synth()
    ok = 0

    s = engine.score(ref, ref)
    assert s["total"] >= 97, s["total"]
    print(f"  ✓ 동일 신호            total={s['total']}")
    ok += 1

    ladder = [("피치+0.5", shift(ref, 0.5)), ("피치+1", shift(ref, 1.0)),
              ("피치+2", shift(ref, 2.0)), ("느리게1.3", slow(ref, 1.3))]
    vals = [("원본", s["total"])]
    for name, y in ladder:
        vals.append((name, engine.score(ref, y)["total"]))
    print("  · 사다리:", " > ".join(f"{n} {v}" for n, v in vals))
    # 원본이 모든 열화본보다 높아야 한다
    assert all(v < vals[0][1] for _, v in vals[1:]), vals
    # 피치 열화는 반음이 커질수록 단조 감소해야 한다
    p_lad = [v for n, v in vals if n == "원본" or n.startswith("피치")]
    for (n1, v1), (n2, v2) in zip(vals[:4], vals[1:4]):
        assert v2 <= v1 + 0.5, f"{n1}({v1}) 보다 {n2}({v2}) 가 높다"
    print("  ✓ 열화 시 점수 하락 (원본 최고, 피치 단조)")
    ok += 1

    # 축이 실제로 다른 값을 낸다 (v3 는 어택==리듬 복사본이었다)
    s2 = engine.score(ref, shift(ref, 1.5))
    assert abs(s2["rhythm"] - s2["stress"]) > 1.5, s2
    print(f"  ✓ 축 독립              리듬={s2['rhythm']} 강세={s2['stress']}")
    ok += 1

    # 음량 불변
    q = engine.score(ref, (ref * 0.3).astype(np.float32))["total"]
    l = engine.score(ref, (ref * 2.0).astype(np.float32))["total"]
    assert abs(q - l) < 6, (q, l)
    print(f"  ✓ 음량 불변            작게={q} 크게={l}")
    ok += 1

    # 앱이 쓰는 이름 호환
    assert "timbre" in s and "attack" in s and "artic" in s and "stress" in s
    print("  ✓ 응답 키 호환         timbre/attack 별칭 유지")
    ok += 1

    print()
    print(f"채점 회귀 테스트 {ok}개 항목 통과  (librosa {librosa.__version__})")


if __name__ == "__main__":
    main()
