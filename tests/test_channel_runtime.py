import math

import pytest

from backend.channel_runtime import CHANNEL_STATELESS_TYPES, _expression, as_channels, as_table, evaluate_channels, make_channels, make_table, number, text_value


@pytest.fixture
def signal():
    return make_channels({"x": [0, 1, 2, 3], "y": [10, 11, 12, 13], "z": [20, 21, 22, 23]}, 4)


def test_portable_named_samples_validate_and_serialize():
    import json
    signal = make_channels({"left": [1, 0, -1], "right": [-1, 0, 1]}, 48000, 1024, True)
    assert as_channels(json.dumps(signal)) == signal
    assert number(signal) == -1
    with pytest.raises(ValueError, match="相等"):
        make_channels({"a": [1], "b": [1, 2]})
    with pytest.raises(ValueError, match="有限"):
        make_channels({"a": [math.inf]})
    with pytest.raises(ValueError, match="重复"):
        make_channels([{"name": "a", "samples": [1]}, {"name": "a", "samples": [2]}])
    assert len(make_channels({str(i): [0] for i in range(512)})["channels"]) == 512


def test_table_csv_roundtrip_is_lossless():
    table = make_table([["name", "value"], ['comma,"quote', "line\nbreak"], ["", ""]])
    assert as_table(text_value(table)) == table
    with pytest.raises(Exception):
        as_table('"unclosed')


def test_merge_select_and_sample_reordering(signal):
    merged = evaluate_channels("channel_merge", {}, {"in": signal, "in2": make_channels({"x": [8, 9]})})
    assert [c["name"] for c in merged["channels"]] == ["x", "y", "z", "x_2"]
    assert merged["channels"][-1]["samples"] == [8, 9, 9, 9]
    selected = evaluate_channels("channel_select", {"channels": "x* z"}, {"in": merged})
    assert [c["name"] for c in selected["channels"]] == ["x", "z", "x_2"]
    transposed = evaluate_channels("native_channel_shuffle", {}, {"in": signal})
    assert transposed["channels"][0]["samples"] == [0, 10, 20]


def test_resampling_matches_sample_timestamps_and_antialiases(signal):
    up = evaluate_channels("channel_resample", {"sample_rate": 8}, {"in": signal})
    assert up["sampleRate"] == 8
    assert up["channels"][0]["samples"] == [0, .5, 1, 1.5, 2, 2.5, 3, 3]
    down = evaluate_channels("channel_resample", {"sample_rate": 2}, {"in": signal})
    assert down["channels"][0]["samples"] == [.5, 2.5]


def test_wave_uses_named_buffers_and_audio_sample_rate():
    result = evaluate_channels("audio_oscillator", {"sample_rate": 48000, "samples": 48, "frequency": 1000, "amplitude": .5}, {}, 0)
    assert result["sampleRate"] == 48000
    assert result["timeSlice"] is True
    assert result["channels"][0]["samples"][12] == pytest.approx(.5)
    assert result["channels"][0]["samples"][36] == pytest.approx(-.5)


def test_vector_cross_angle_and_math():
    x, y = make_channels({"x": [1], "y": [0], "z": [0]}), make_channels({"x": [0], "y": [1], "z": [0]})
    cross = evaluate_channels("channel_cross", {}, {"in": x, "in2": y})
    assert [ch["samples"][0] for ch in cross["channels"]] == [0, 0, 1]
    assert evaluate_channels("channel_angle", {}, {"in": x, "in2": y})["channels"][0]["samples"] == [90]
    with pytest.raises(ZeroDivisionError):
        evaluate_channels("channel_math", {"mode": "divide"}, {"in": x, "in2": 0})


def test_arithmetic_parser_never_executes_python():
    assert _expression("clamp(sin(pi/2)+x*2,0,4)")({"x": 3}) == 4
    assert _expression("x>0 && x<2")({"x": 1}) == 1
    assert _expression("!(x>2) || x<0")({"x": 1}) == 1
    assert _expression("-2^2")({}) == -4
    assert _expression("-3%2")({}) == -1
    for expr in ["__import__('os').getcwd()", "x.__class__", "[x for x in range(100)]", "open('/etc/passwd')"]:
        with pytest.raises(ValueError):
            _expression(expr)({})


def test_table_channel_conversion_preserves_every_sample():
    table = make_table([["a", "b"], ["1", "10"], ["2", "20"]])
    signal = evaluate_channels("dat_to_channels", {"sample_rate": 48000}, {"in": table})
    assert signal["channels"] == [{"name": "a", "samples": [1, 2]}, {"name": "b", "samples": [10, 20]}]
    assert evaluate_channels("channels_to_dat", {}, {"in": signal}) == table


def test_table_native_insert_evaluate():
    table = make_table([["a", "1"], ["b", "2"]])
    assert evaluate_channels("native_insert", {"mode": "columns", "index": 1}, {"in": table, "in2": make_table([["x"], ["y"]])}) == make_table([["a", "x", "1"], ["b", "y", "2"]])
    assert evaluate_channels("dat_evaluate", {"expression": "x+col", "header": False}, {"in": make_table([[1, 2], [3, 4]])}) == make_table([[1, 3], [3, 5]])


@pytest.mark.parametrize("kind", sorted(CHANNEL_STATELESS_TYPES))
def test_registered_headless_operators_have_real_finite_execution(kind, signal):
    import json
    p = {}
    a, b = signal, make_channels({"x": [1, 2, 3, 4], "y": [2, 3, 4, 5], "z": [3, 4, 5, 6]}, 4)
    if kind.startswith("native_") and kind != "native_channel_shuffle" or kind.startswith("dat_"):
        a, b = make_table([["name", "value"], ["alpha", 1], ["beta", 2]]), make_table([["c", 3]])
    if kind == "dat_to_channels":
        a = make_table([["x", "y"], [1, 2], [3, 4]])
    result = evaluate_channels(kind, p, {"in": a, "in2": b}, 1)
    json.dumps(result, allow_nan=False)
    assert result is not None


def test_history_is_never_fabricated_in_stateless_http():
    with pytest.raises(ValueError, match="连续"):
        evaluate_channels("channel_record", {}, {"in": 1}, 0)
