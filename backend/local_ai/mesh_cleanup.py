"""Select generated surfaces without treating volume-decoder boundary shells as objects."""

def select_generated_surface(components):
    import numpy as np
    if not len(components):
        raise ValueError('模型没有生成可用的三维表面，请换用主体清晰的参考图片')
    largest = max(components, key=lambda part: len(part.faces))
    meaningful = [part for part in components if len(part.faces) >= max(32, len(largest.faces) * .01)]
    interior = []
    for part in meaningful:
        low, high = part.bounds
        extent = np.maximum(high-low, 1e-8)
        distance = np.minimum(abs(part.vertices-low), abs(part.vertices-high))/extent
        # Six flat walls near the volume limits are an extraction artifact. A
        # generated cube remains valid when no substantial inner object exists.
        boundary_fraction = np.mean(np.min(distance, axis=1) < .015)
        if boundary_fraction < .85:
            interior.append(part)
    candidates = interior or meaningful or [largest]
    # Surface-net extraction can also produce an inward-facing exterior shell.
    # Prefer substantial outward surfaces; retain inward input if it is all we have.
    minimum_faces = max(len(part.faces) for part in candidates) * .5
    outward = [part for part in candidates if part.volume > 0 and len(part.faces) >= minimum_faces]
    return max(outward or candidates, key=lambda part: len(part.faces))
