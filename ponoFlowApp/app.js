const navButtons = Array.from(document.querySelectorAll('.nav-button'));
const views = Array.from(document.querySelectorAll('.view'));
const modalTriggers = Array.from(
  document.querySelectorAll('[data-modal]')
);

function activateSection(sectionId) {
  navButtons.forEach((button) => {
    const isActive = button.dataset.section === sectionId;
    button.classList.toggle('active', isActive);
    if (isActive) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  views.forEach((view) => {
    const isActive = view.dataset.section === sectionId;
    view.classList.toggle('active', isActive);
    if (isActive) {
      view.focus();
    }
  });
}

function openModal(modalId) {
  const dialog = document.getElementById(`modal-${modalId}`);
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  }
}

function attachEventListeners() {
  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activateSection(button.dataset.section);
    });
  });

  modalTriggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      openModal(trigger.dataset.modal);
    });
  });

  const dialogs = Array.from(document.querySelectorAll('dialog'));
  dialogs.forEach((dialog) => {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  activateSection('dashboard');
  attachEventListeners();
});
