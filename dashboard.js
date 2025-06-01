const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

// Load user data from localStorage
const code = localStorage.getItem('accessCode');
const subject = localStorage.getItem('subject');
const plan = localStorage.getItem('plan');

if (!code || !subject || !plan) {
  alert('Missing user data. Please log in again.');
  window.location.href = 'index.html';
}

if (plan !== 'premium') {
  document.getElementById('ai-chat-section').innerHTML = `
    <div class="text-center text-gray-400 mt-8">
      <p>You need a <strong>Premium</strong> plan to access the AI chat.</p>
    </div>
  `;
}

// Handle form submission
chatForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  appendMessage('You', message);
  chatInput.value = '';
  chatInput.disabled = true;

  try {
    const res = await fetch('/api-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, subject })
    });

    const data = await res.json();

    if (data.reply) {
      appendMessage('SkillCraft AI', data.reply);
    } else {
      appendMessage('SkillCraft AI', '⚠️ Error: No reply received from AI.');
    }
  } catch (err) {
    appendMessage('SkillCraft AI', '⚠️ Error contacting AI. Please try again.');
  } finally {
    chatInput.disabled = false;
    chatInput.focus();
  }
});

// Display a chat message
function appendMessage(sender, text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'mb-4';
  messageDiv.innerHTML = `<strong class="text-indigo-300">${sender}:</strong> <span>${text}</span>`;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
