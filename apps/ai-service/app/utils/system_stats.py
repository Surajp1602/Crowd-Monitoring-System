"""Host and GPU utilisation for the system-health page, sampled cheaply.

GPU numbers come from torch when the detector has loaded it, otherwise from
`nvidia-smi` (cached, since spawning it costs tens of milliseconds). Hosts without an
NVIDIA GPU simply report none.
"""

import shutil
import subprocess
import sys
import time

import psutil

_GPU_CACHE: tuple[float, list[dict]] = (0.0, [])
_GPU_TTL_S = 15.0


def _nvidia_smi() -> list[dict]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return []
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, check=True,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return []
    gpus = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 5:
            name, util, used, total, temp = parts
            gpus.append({
                "name": name,
                "utilization_pct": float(util),
                "memory_used_mb": float(used),
                "memory_total_mb": float(total),
                "temperature_c": float(temp),
            })
    return gpus


def gpu_stats() -> list[dict]:
    global _GPU_CACHE
    ts, cached = _GPU_CACHE
    if time.time() - ts < _GPU_TTL_S:
        return cached
    gpus = _nvidia_smi()
    torch = sys.modules.get("torch")
    if torch is not None and torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            allocated = torch.cuda.memory_allocated(i) / 2**20
            if i < len(gpus):
                gpus[i]["torch_allocated_mb"] = round(allocated, 1)
            else:
                gpus.append({"name": torch.cuda.get_device_name(i), "torch_allocated_mb": round(allocated, 1)})
    _GPU_CACHE = (time.time(), gpus)
    return gpus


def host_stats() -> dict:
    mem = psutil.virtual_memory()
    proc = psutil.Process()
    return {
        "cpu_pct": psutil.cpu_percent(interval=None),
        "cpu_count": psutil.cpu_count(),
        "memory_pct": mem.percent,
        "process_rss_mb": round(proc.memory_info().rss / 2**20, 1),
        "gpus": gpu_stats(),
    }
