document.getElementById('bulkForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const rawNumbers = document.getElementById('phoneNumbers').value;
  const amount = document.getElementById('amount').value;
  const reference = document.getElementById('reference').value;
  const submitBtn = document.getElementById('submitBtn');

  // Split inputs by newline or comma
  const phoneNumbers = rawNumbers
    .split(/[\n,]+/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (phoneNumbers.length === 0) {
    alert('Please enter at least one valid phone number.');
    return;
  }

  // UI Setup
  submitBtn.disabled = true;
  document.getElementById('progressContainer').classList.remove('hidden');
  const logBody = document.getElementById('logBody');
  logBody.innerHTML = '';
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  // Initiate Streaming SSE Request
  const response = await fetch('/api/process-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumbers, amount, reference })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop(); // Keep unfinished chunk in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.replace('data: ', ''));

        if (data.type === 'start') {
          progressText.innerText = `0 / ${data.total} Processed`;
        } else if (data.type === 'log') {
          // Update Progress
          const pct = Math.round((data.index / data.total) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.innerText = `${data.index} / ${data.total} Processed (${pct}%)`;

          // Append Log Row
          const row = document.createElement('tr');
          row.innerHTML = `
            <td>${data.index}</td>
            <td>${data.phone}</td>
            <td>KES ${data.amount}</td>
            <td><span class="badge-${data.status}">${data.status}</span></td>
            <td>${data.details}</td>
          `;
          logBody.prepend(row);
        } else if (data.type === 'complete') {
          submitBtn.disabled = false;
        }
      }
    }
  }
});
