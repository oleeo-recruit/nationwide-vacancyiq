(() => {
  'use strict';
  const menuButton = document.getElementById('menu-toggle');
  const navigation = document.getElementById('navigation');
  function closeMenu() {
    navigation.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
  }
  menuButton.addEventListener('click', () => {
    const isOpen = navigation.classList.toggle('is-open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });
  navigation.querySelectorAll('a,button').forEach(item => item.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && navigation.classList.contains('is-open')) {
      closeMenu();
      menuButton.focus();
    }
  });

  const status = document.getElementById('chat-status');
  const statusText = document.getElementById('chat-status-text');
  const retry = document.getElementById('chat-retry');
  let userWantsChat = false;
  let isReady = false;
  let loading = null;
  let scriptPromise = null;
  let connectionTimedOut = false;
  let statusTimer;
  const config = window.VACANCYIQ_CONFIG;
  const assetURL = name => new URL('assets/' + name, document.baseURI).href;

  function showStatus(message, canRetry = false) {
    clearTimeout(statusTimer);
    statusText.textContent = message;
    retry.hidden = !canRetry;
    status.hidden = false;
  }
  document.getElementById('chat-dismiss').addEventListener('click', () => { status.hidden = true; });

  // Retains the ext_disableInput trace used by the supplied Voiceflow workflow.
  // Watches for input re-renders without replacing the textarea value descriptor.
  let inputDisabled = false;
  let inputObserver = null;
  let inputRetryTimer = null;
  let inputRetries = 0;
  const changedControls = new Map();
  function findChatRoot() {
    if (window.voiceflow?.chat?._shadowRoot) return window.voiceflow.chat._shadowRoot;
    for (const host of document.querySelectorAll('*')) {
      if (host.shadowRoot?.querySelector('textarea.vfrc-chat-input')) return host.shadowRoot;
    }
    return null;
  }
  function applyInputState() {
    const root = findChatRoot();
    if (!root) {
      if (inputDisabled && inputRetries++ < 40) inputRetryTimer = setTimeout(applyInputState, 250);
      return;
    }
    root.querySelectorAll('textarea.vfrc-chat-input, #vfrc-send-message').forEach(control => {
      if (inputDisabled) {
        if (!changedControls.has(control)) changedControls.set(control, {
          disabled: control.disabled,
          readOnly: control.readOnly,
          ariaDisabled: control.getAttribute('aria-disabled')
        });
        control.disabled = true;
        if (control.tagName === 'TEXTAREA') control.readOnly = true;
        control.setAttribute('aria-disabled', 'true');
      }
    });
    if (inputDisabled && !inputObserver) {
      inputObserver = new MutationObserver(applyInputState);
      inputObserver.observe(root, { childList: true, subtree: true });
    }
  }
  const DisableInputExtension = {
    name: 'DisableInput',
    type: 'effect',
    match: ({ trace }) => trace.type === 'ext_disableInput' || trace.payload?.name === 'ext_disableInput',
    effect: ({ trace }) => {
      inputDisabled = trace.payload?.isDisabled === true || trace.payload?.isDisabled === 'true';
      clearTimeout(inputRetryTimer);
      inputObserver?.disconnect();
      inputObserver = null;
      inputRetries = 0;
      if (!inputDisabled) {
        changedControls.forEach((previous, control) => {
          control.disabled = previous.disabled;
          if (control.tagName === 'TEXTAREA') control.readOnly = previous.readOnly;
          if (previous.ariaDisabled === null) control.removeAttribute('aria-disabled');
          else control.setAttribute('aria-disabled', previous.ariaDisabled);
        });
        changedControls.clear();
      } else applyInputState();
    }
  };

  function loadWidgetScript() {
    if (window.voiceflow?.chat?.load) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = 'vacancyiq-voiceflow-widget';
      script.src = 'https://cdn.voiceflow.com/widget-next/bundle.mjs';
      script.type = 'text/javascript';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        scriptPromise = null;
        reject(new Error('The chat script could not be loaded.'));
      };
      document.head.appendChild(script);
    });
    return scriptPromise;
  }

  function ensureChat() {
    if (loading) return loading;
    if (!config?.projectID) return Promise.reject(new Error('A Voiceflow project ID is required.'));
    loading = loadWidgetScript().then(() => window.voiceflow.chat.load({
      verify: { projectID: config.projectID },
      url: config.runtimeURL,
      versionID: config.versionID,
      voice: { url: config.voiceURL },
      assistant: {
        color: '#011546',
        fontFamily: 'Arial',
        header: { title: 'Nationwide VacancyIQ', imageUrl: assetURL('chat-icon.svg') },
        banner: {
          title: 'Let’s bring your next role to life.',
          description: 'Your Nationwide recruitment content assistant. Start with the role, and we’ll build from there.',
          imageUrl: assetURL('chat-icon.svg')
        },
        avatar: { imageUrl: assetURL('chat-icon.svg') },
        launcher: { imageUrl: assetURL('chat-icon.svg'), label: 'Open VacancyIQ' },
        inputPlaceholder: 'Tell me about the role…',
        stylesheet: assetURL('widget.css'),
        extensions: [DisableInputExtension]
      }
    })).then(() => {
      isReady = true;
      connectionTimedOut = false;
      clearTimeout(statusTimer);
      window.voiceflow.chat.proactive?.clear();
      if (userWantsChat) {
        window.voiceflow.chat.open();
        status.hidden = true;
      } else {
        window.voiceflow.chat.proactive?.push({ type: 'text', payload: { message: config.greeting } });
      }
    }).catch(error => {
      console.warn('VacancyIQ chat could not be loaded.', error);
      loading = null;
      if (userWantsChat) showStatus('We couldn’t connect to VacancyIQ. Please check your connection and try again.', true);
      throw error;
    });
    return loading;
  }

  function openChat() {
    userWantsChat = true;
    if (isReady) {
      window.voiceflow.chat.open();
      status.hidden = true;
      return;
    }
    if (connectionTimedOut) {
      // The original request can still complete. A reload avoids parallel loaders.
      window.location.reload();
      return;
    }
    showStatus('Opening VacancyIQ. One moment…');
    statusTimer = setTimeout(() => {
      if (!isReady) {
        connectionTimedOut = true;
        showStatus('VacancyIQ is taking longer than expected. Please try again to refresh the connection.', true);
      }
    }, 25000);
    ensureChat().catch(() => {});
  }
  document.querySelectorAll('[data-chat]').forEach(button => button.addEventListener('click', openChat));
  retry.addEventListener('click', openChat);
  // Load once, after the local page is ready. All buttons share the same promise.
  ensureChat().catch(() => {});
})();
