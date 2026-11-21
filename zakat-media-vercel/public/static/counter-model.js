/* Модель демонстрационного счётчика «Сейчас на сайте».
   Это НЕ реальная статистика, на странице под счётчиком есть подпись об этом.
   Число зависит от времени суток посетителя и меняется плавно. Работает и в браузере, и в Node (для тестов). */
(function (root) {
  "use strict";

  /* Опорные точки суток: [час, значение]. Между ними значение меняется по прямой.
     Точка 25 означает 01:00 следующих суток. Правьте числа здесь. */
  var ANCHORS = [[1, 450], [4, 280], [6, 420], [8, 700], [12, 1000], [17, 1200], [19, 1700], [21, 2300], [23, 1500], [25, 450]];

  /* Окна, в которых значение жёстко держится в заданных пределах. Вне окон идёт плавный переход. */
  var WINDOWS = [
    { name: "ночь", from: 1, to: 6, min: 250, max: 500 },
    { name: "день", from: 8, to: 17, min: 500, max: 1250 },
    { name: "вечер", from: 19, to: 23, min: 1250, max: 2500 }
  ];

  var NOISE_LIMIT = 0.03;  // случайное отклонение не больше 3% от базовой кривой
  var NOISE_STEP = 0.012;  // и меняется оно медленно
  var MAX_STEP = 0.012;    // число за одно обновление меняется не больше чем на 1,2%

  function hourOf(date) { return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600; }

  function baseline(hour) {
    var h = hour < ANCHORS[0][0] ? hour + 24 : hour;
    for (var i = 0; i < ANCHORS.length - 1; i++) {
      var a = ANCHORS[i], b = ANCHORS[i + 1];
      if (h >= a[0] && h <= b[0]) return a[1] + (b[1] - a[1]) * ((h - a[0]) / (b[0] - a[0]));
    }
    return ANCHORS[0][1];
  }

  function clampToWindow(value, hour) {
    for (var i = 0; i < WINDOWS.length; i++) {
      var w = WINDOWS[i];
      if (hour >= w.from && hour <= w.to) return Math.min(w.max, Math.max(w.min, value));
    }
    return value;
  }

  /* Счётчик со своим состоянием. now() возвращает дату, rng() случайное число от 0 до 1. */
  function createCounter(now, rng) {
    var noise = (rng() - 0.5) * 2 * NOISE_LIMIT;
    var hour = hourOf(now());
    var shown = clampToWindow(baseline(hour) * (1 + noise), hour);

    return {
      value: function () { return Math.round(shown); },
      tick: function () {
        hour = hourOf(now());
        noise = Math.max(-NOISE_LIMIT, Math.min(NOISE_LIMIT, noise + (rng() - 0.5) * NOISE_STEP * 2));
        var goal = baseline(hour) * (1 + noise);
        var limit = Math.max(2, shown * MAX_STEP);
        shown += Math.max(-limit, Math.min(limit, goal - shown));
        shown = clampToWindow(shown, hour);
        return Math.round(shown);
      }
    };
  }

  var api = { ANCHORS: ANCHORS, WINDOWS: WINDOWS, baseline: baseline, clampToWindow: clampToWindow, createCounter: createCounter, hourOf: hourOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CounterModel = api;
})(typeof window !== "undefined" ? window : this);
