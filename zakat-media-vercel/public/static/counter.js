/* Показывает демонстрационный счётчик из counter-model.js и обновляет его каждые 5–9 секунд.
   Это не реальная статистика: под счётчиком на странице есть подпись об этом. */
(function () {
  var el = document.getElementById("online-count");
  if (!el || !window.CounterModel) return;

  var counter = window.CounterModel.createCounter(function () { return new Date(); }, Math.random);
  el.textContent = counter.value();

  function tick() {
    el.textContent = counter.tick();
    setTimeout(tick, 5000 + Math.random() * 4000);
  }
  setTimeout(tick, 5000);
})();
