export function ageText(timestamp, now = Date.now()) {
  const time = Date.parse(timestamp || '');
  if (!Number.isFinite(time)) return 'nunca coletado';
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  if (hours < 24) return `há ${hours} h${remainder ? ` ${remainder} min` : ''}`;
  const days = Math.floor(hours / 24), remainingHours = hours % 24;
  return `há ${days} dia${days === 1 ? '' : 's'}${remainingHours ? ` ${remainingHours} h` : ''}`;
}

export function oldestSuccessfulTimestamp(items, fallback = '') {
  const times = items.filter(item => item?.complete && !item.error).map(item => item.queriedAt || fallback).filter(value => Number.isFinite(Date.parse(value)));
  return times.length ? times.reduce((oldest, value) => Date.parse(value) < Date.parse(oldest) ? value : oldest) : '';
}

export function showAge(element, label, timestamp) {
  if (!element) return;
  element.dataset.collectedAt = timestamp || '';
  element.dataset.ageLabel = label;
  element.textContent = `${label}: ${ageText(timestamp)}.`;
}

export function refreshAges(root = document) {
  for (const element of root.querySelectorAll('[data-age-label]')) showAge(element, element.dataset.ageLabel, element.dataset.collectedAt);
}
