/* ==========================================
   Wassal AI Chatbot — Coming Soon Logic
   ========================================== */

(function () {
  'use strict';

  const modal = document.getElementById('coming-soon-modal');
  const btnNewChat = document.getElementById('btn-new-chat');
  const btnNewChatMobile = document.getElementById('btn-new-chat-mobile');
  const btnSend = document.getElementById('btn-send');
  const btnVoice = document.getElementById('btn-voice');
  const chatInput = document.getElementById('chat-input');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileSidebar = document.getElementById('mobile-sidebar');
  const mobileSidebarOverlay = document.getElementById('mobile-sidebar-overlay');
  const btnCloseSidebar = document.getElementById('btn-close-sidebar');

  function openModal() {
    if (modal) {
      modal.classList.add('active');
    }
  }

  window.closeModal = function () {
    if (modal) {
      modal.classList.remove('active');
    }
  };

  if (btnNewChat) {
    btnNewChat.addEventListener('click', openModal);
  }

  if (btnNewChatMobile) {
    btnNewChatMobile.addEventListener('click', function () {
      closeMobileSidebar();
      openModal();
    });
  }

  if (btnSend) {
    btnSend.addEventListener('click', openModal);
  }

  if (btnVoice) {
    btnVoice.addEventListener('click', openModal);
  }

  if (chatInput) {
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        openModal();
      }
    });

    chatInput.addEventListener('focus', function () {
      if (chatInput.disabled) {
        chatInput.blur();
        openModal();
      }
    });
  }

  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeModal();
      }
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
      closeModal();
    }
  });

  function openMobileSidebar() {
    if (mobileSidebar) {
      mobileSidebar.classList.add('active');
    }
    if (mobileSidebarOverlay) {
      mobileSidebarOverlay.classList.add('active');
    }
    document.body.style.overflow = 'hidden';
  }

  function closeMobileSidebar() {
    if (mobileSidebar) {
      mobileSidebar.classList.remove('active');
    }
    if (mobileSidebarOverlay) {
      mobileSidebarOverlay.classList.remove('active');
    }
    document.body.style.overflow = '';
  }

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', openMobileSidebar);
  }

  if (btnCloseSidebar) {
    btnCloseSidebar.addEventListener('click', closeMobileSidebar);
  }

  if (mobileSidebarOverlay) {
    mobileSidebarOverlay.addEventListener('click', closeMobileSidebar);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && mobileSidebar && mobileSidebar.classList.contains('active')) {
      closeMobileSidebar();
    }
  });
})();
