(() => {
  const canvas = document.querySelector('#signature-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let touched = false;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(box.width * ratio));
      canvas.height = Math.max(1, Math.floor(box.height * ratio));
      ctx.scale(ratio, ratio);
      ctx.strokeStyle = '#17324d';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };
    resize();
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      const source = event.touches ? event.touches[0] : event;
      return [source.clientX - rect.left, source.clientY - rect.top];
    };
    const start = (event) => {
      event.preventDefault(); drawing = true; touched = true;
      const [x, y] = point(event); ctx.beginPath(); ctx.moveTo(x, y);
    };
    const move = (event) => {
      if (!drawing) return; event.preventDefault();
      const [x, y] = point(event); ctx.lineTo(x, y); ctx.stroke();
    };
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    document.querySelector('#clear-signature')?.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); touched = false;
    });
    document.querySelector('#signature-form')?.addEventListener('submit', (event) => {
      const mode = event.submitter?.value || document.querySelector('input[name=signature_mode]:checked')?.value || 'draw';
      document.querySelector('#signature-mode').value = mode;
      if (mode === 'draw') {
        if (!touched) { event.preventDefault(); alert('请先在签名板上签名。'); return; }
        document.querySelector('#signature-data').value = canvas.toDataURL('image/png');
      }
    });
  }

  const upload = document.querySelector('#photo-input');
  if (upload) {
    upload.addEventListener('change', () => {
      const count = upload.files?.length || 0;
      const label = document.querySelector('#photo-count');
      if (label) label.textContent = count ? `已选择 ${count} 张照片` : '可一次选择多张照片';
    });
  }

  document.querySelectorAll('[data-confirm]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (!window.confirm(element.dataset.confirm)) event.preventDefault();
    });
  });
})();
