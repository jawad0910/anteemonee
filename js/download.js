document.addEventListener('DOMContentLoaded', initDownload);

function initDownload() {
  // Page works for everyone, no auth required
}

function showDownloadModal(platform) {
  const modal = document.getElementById('download-modal');
  const nameEl = document.getElementById('modal-platform-name');
  const iconEl = document.getElementById('modal-platform-icon');

  nameEl.textContent = `Wassal for ${platform}`;

  const icons = {
    'Android': '🤖',
    'iOS': '',
    'Windows': '🪟',
    'macOS': ''
  };
  iconEl.textContent = icons[platform] || '';

  modal.classList.add('open');
}

function closeDownloadModal() {
  document.getElementById('download-modal').classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeDownloadModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDownloadModal();
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.roadmap-item').forEach(item => {
  item.style.opacity = '0';
  item.style.transform = 'translateY(20px)';
  item.style.transition = 'all 0.5s ease';
  observer.observe(item);
});
