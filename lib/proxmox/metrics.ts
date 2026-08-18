export function formatPercent(value: number | undefined) {
  if (value === undefined) {
    return "Not reported";
  }

  const percent = value * 100;
  return `${percent < 10 ? percent.toFixed(1) : percent.toFixed(0)}%`;
}

export function formatBytes(value: number | undefined) {
  if (value === undefined) {
    return "Not reported";
  }

  if (value === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const scaled = value / 1024 ** unitIndex;

  return `${scaled >= 10 || unitIndex === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unitIndex]}`;
}

export function formatUsage(
  used: number | undefined,
  maximum: number | undefined,
) {
  if (used === undefined || maximum === undefined) {
    return "Not reported";
  }

  const percent = maximum > 0 ? used / maximum : 0;
  return `${formatBytes(used)} / ${formatBytes(maximum)} (${formatPercent(percent)})`;
}

export function formatUptime(seconds: number | undefined) {
  if (seconds === undefined) {
    return "Not reported";
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days) {
    return `${days}d ${hours}h`;
  }

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}
