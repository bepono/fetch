const navButtons = Array.from(document.querySelectorAll('.nav-button'));
const views = Array.from(document.querySelectorAll('.view'));
const modalTriggers = Array.from(
  document.querySelectorAll('[data-modal]')
);
const toolListEl = document.getElementById('tool-list');
const addToolButton = document.getElementById('add-tool');

const catalog = [
  {
    id: 'chromium',
    name: 'Chromium (netns)',
    description: 'Browser launched inside the chrome-ns network namespace.',
    command: 'ip netns exec chrome-ns chromium --app=https://chat.openai.com/chat'
  },
  {
    id: 'code',
    name: 'VS Code',
    description: 'Editor wrapped with user/mount namespaces via run_isolated.',
    command: 'run_isolated codium code --disable-telemetry'
  },
  {
    id: 'xterm',
    name: 'xterm',
    description: 'Lightweight terminal launched in its own overlay.',
    command: 'run_isolated xterm xterm'
  },
  {
    id: 'dbus',
    name: 'DBus session',
    description: 'Ephemeral message bus for GUI helpers.',
    command: 'run_isolated dbus dbus-launch'
  }
];

const state = {
  activeTools: [...catalog]
};

function renderTools() {
  if (!toolListEl) return;
  toolListEl.innerHTML = '';

  state.activeTools.forEach((tool) => {
    const row = document.createElement('div');
    row.className = 'tool-row';
    row.setAttribute('role', 'listitem');
    row.innerHTML = `
      <div class="tool-header">
        <strong>${tool.name}</strong>
        <div class="chip">${tool.id}</div>
      </div>
      <p class="card-subtitle">${tool.description}</p>
      <div class="tool-actions">
        <button class="pill" data-action="launch" data-tool="${tool.id}">Launch isolated</button>
        <button class="secondary" data-action="remove" data-tool="${tool.id}">Remove overlay</button>
      </div>
      <code>${tool.command}</code>
    `;
    toolListEl.appendChild(row);
  });
}

function addAnotherTool() {
  const remaining = catalog.filter(
    (tool) => !state.activeTools.find((item) => item.id === tool.id)
  );

  if (!remaining.length) {
    alert('All catalog tools are already listed.');
    return;
  }

  state.activeTools.push(remaining[0]);
  renderTools();
}

function handleToolActions(event) {
  const target = event.target.closest('button[data-action]');
  if (!target) return;

  const toolId = target.dataset.tool;
  const tool = state.activeTools.find((item) => item.id === toolId);
  if (!tool) return;

  if (target.dataset.action === 'launch') {
    console.log(`Would launch: ${tool.command}`);
    alert(`Launching in isolation: ${tool.command}`);
  }

  if (target.dataset.action === 'remove') {
    state.activeTools = state.activeTools.filter((item) => item.id !== toolId);
    renderTools();
  }
}

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

  if (addToolButton) {
    addToolButton.addEventListener('click', addAnotherTool);
  }

  if (toolListEl) {
    toolListEl.addEventListener('click', handleToolActions);
  }

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
  renderTools();
});
