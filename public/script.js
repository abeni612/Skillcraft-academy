document.addEventListener('DOMContentLoaded', () => {
  // Steps map
  const steps = {
    splash:      document.getElementById('step-splash'),
    'user-info': document.getElementById('step-user-info'),
    subject:     document.getElementById('step-subject'),
    pricing:     document.getElementById('step-pricing'),
    payment:     document.getElementById('step-payment'),
  };

  // Elements
  const getStartedBtn    = document.getElementById('get-started-btn');
  const userInfoForm     = document.getElementById('user-info-form');
  const subjectCards     = document.querySelectorAll('.subject-card');
  const subjectNextBtn   = document.getElementById('subject-next-btn');
  const pricingOptions   = document.querySelectorAll('.pricing-option');
  const proceedBtn       = document.getElementById('proceed-to-payment-btn');
  const paymentForm      = document.getElementById('payment-form');
  const emailInput       = document.getElementById('email');
  const emailError       = document.getElementById('email-error');
  const receiptInput     = document.getElementById('receipt');
  const receiptError     = document.getElementById('receipt-error');
  const submitPaymentBtn = document.getElementById('submit-payment-btn');

  const titleEl        = document.getElementById('selected-subject-title');
  const normalPriceEl  = document.getElementById('normal-price');
  const premiumPriceEl = document.getElementById('premium-price');

  // Pricing data
  const pricingData = {
    'web-dev': { normal: 1000, premium: 1500, title: 'Web Design & Development' },
    graphics:  { normal: 800,  premium: 1100, title: 'Graphics Design'         },
    video:     { normal: 600,  premium: 1000, title: 'Video Editing'           },
    content:   { normal: 600,  premium: 1000, title: 'Content Creation'        },
  };

  // State
  let current = 'splash';
  let selectedSubject = null;
  let userInfo = { name: '', age: 0, email: '' };

  // Show Get Started after 1s
  setTimeout(() => getStartedBtn.classList.remove('opacity-0'), 1000);

  // Handlers
  getStartedBtn.onclick = () => navigate('user-info');

  userInfoForm.onsubmit = e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const age  = parseInt(e.target.age.value, 10);
    let valid = true;
    document.getElementById('name-error').classList.add('hidden');
    document.getElementById('age-error').classList.add('hidden');

    if (!name) {
      document.getElementById('name-error').classList.remove('hidden');
      valid = false;
    }
    if (isNaN(age) || age < 10) {
      const err = document.getElementById('age-error');
      err.textContent = isNaN(age) ? 'Please enter a valid age' : 'You must be at least 10 years old';
      err.classList.remove('hidden');
      valid = false;
    }
    if (valid) {
      userInfo.name = name;
      userInfo.age  = age;
      navigate('subject');
    }
  };

  subjectCards.forEach(card => card.onclick = () => {
    subjectCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedSubject = card.dataset.subject;
    subjectNextBtn.disabled = false;
    subjectNextBtn.classList.remove('opacity-50','cursor-not-allowed');
  });

  subjectNextBtn.onclick = () => {
    if (!selectedSubject) return;
    updatePricing();
    navigate('pricing');
  };

  pricingOptions.forEach(opt => opt.onclick = () => {
    pricingOptions.forEach(o => o.classList.remove('border-indigo-500','bg-gray-600'));
    opt.classList.add('border-indigo-500','bg-gray-600');
    opt.querySelector('input').checked = true;
    proceedBtn.disabled = false;
    proceedBtn.classList.remove('opacity-50','cursor-not-allowed');
  });

  proceedBtn.onclick = () => {
    navigate('payment');
  };

  // Payment form logic
  emailInput.oninput = () => {
    if (emailInput.validity.valid) {
      emailError.classList.add('hidden');
    }
  };

  receiptInput.onchange = () => {
    if (receiptInput.files.length) {
      receiptError.classList.add('hidden');
      if (emailInput.validity.valid) {
        submitPaymentBtn.disabled = false;
        submitPaymentBtn.classList.remove('opacity-50','cursor-not-allowed');
      }
    }
  };

  paymentForm.onsubmit = async e => {
    e.preventDefault();

    // Validate email
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      emailError.classList.remove('hidden');
      return;
    }
    userInfo.email = email;

    // Validate screenshot
    if (!receiptInput.files.length) {
      receiptError.classList.remove('hidden');
      return;
    }

    // Telegram config
    const chatId   = 6194248175;    // replace with your admin/test chat ID
    const botToken = '7561159215:AAEU1RboZlbyT0BiYEXS8m2c7-TGZXiMi_8'; // your bot token
    const file     = receiptInput.files[0];
    const plan     = document.querySelector('input[name="plan"]:checked').value;
    const amount   = plan === 'normal'
      ? pricingData[selectedSubject].normal
      : pricingData[selectedSubject].premium;

    // Build the caption, including email
    const caption = 
      `🧾 *New Payment Submission*\n` +
      `👤 Name: ${userInfo.name}\n` +
      `🎂 Age: ${userInfo.age}\n` +
      `📚 Subject: ${pricingData[selectedSubject].title}\n` +
      `💼 Plan: ${plan}\n` +
      `💰 Amount: ETB ${amount}\n` +
      ` Email: ${userInfo.email}`;

    // ... earlier code ...

const formData = new FormData();
formData.append('chat_id',    chatId);
formData.append('caption',    caption);
formData.append('parse_mode', 'Markdown');
formData.append('photo',      file);
formData.append('reply_markup', JSON.stringify({
  inline_keyboard: [[
    { text: '✅ Approve',  callback_data: 'approve' },
    { text: '❌ Decline', callback_data: 'decline' }
  ]]
}));

await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
  method: 'POST',
  body: formData
});


    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        body: formData
      });
      alert('Payment submitted! Admin will review within 24h.');
    } catch (err) {
      console.error(err);
      alert('Submission failed. Try again.');
    }
  };

  // Helpers
  function updatePricing() {
    const data = pricingData[selectedSubject];
    titleEl.textContent        = data.title;
    normalPriceEl.textContent  = `ETB ${data.normal}`;
    premiumPriceEl.textContent = `ETB ${data.premium}`;
    document.querySelectorAll('input[name="plan"]').forEach(r => r.checked = false);
    proceedBtn.disabled = true;
    proceedBtn.classList.add('opacity-50','cursor-not-allowed');
  }

  function navigate(to) {
    steps[current].classList.replace('step-visible','step-hidden');
    steps[to].classList.replace('step-hidden','step-visible');
    current = to;
    // auto-scroll
    steps[to].scrollIntoView({ behavior: 'smooth' });
  }
});
