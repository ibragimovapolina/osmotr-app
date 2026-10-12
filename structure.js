// ================= Локальная сборка формы =================
//
// Полностью повторяет getFormStructure с бэкенда, но собирает разделы
// локально из кэша справочника и правил замечаний. Нужна для офлайна.

function parseIntSafe(v) {
  if (v === null || v === undefined) return 0;
  const m = String(v).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function buildFormStructure(apartment) {
  const roomsNum  = parseIntSafe(apartment && apartment.roomsNum);
  const bathrooms = parseIntSafe(apartment && apartment.bathrooms);
  const laundry   = String(apartment && apartment.laundry || '').toLowerCase().trim();
  const wardrobe  = String(apartment && apartment.wardrobe || '').toLowerCase().trim();
  const winR1     = parseIntSafe(apartment && apartment.winR1);
  const winR2     = parseIntSafe(apartment && apartment.winR2);
  const winR3     = parseIntSafe(apartment && apartment.winR3);
  const winK      = parseIntSafe(apartment && apartment.winK);

  const isYes = (v) => v === 'да' || v === 'yes' || v === 'true' || v === '1' || v === '+' || v === 'есть';

  const divisions = [];

  divisions.push({
    key: 'koridor', title: 'Коридор',
    objects: [
      { key: 'vhodnaya_dver', label: 'Входная дверь', criterion: 'Входная дверь' },
      { key: 'steny',         label: 'Стены',         criterion: 'Стены' },
      { key: 'poly',          label: 'Полы',          criterion: 'Полы' },
      { key: 'potolki',       label: 'Потолки',       criterion: 'Потолки' },
      { key: 'elektro',       label: 'Электроснабжение', criterion: 'Электроснабжение' },
      { key: 'shit',          label: 'Квартирный щит', criterion: 'Щит' },
      { key: 'seti',          label: 'Сети связи',    criterion: 'Сети связи' },
      { key: 'ops',           label: 'ОПС',           criterion: 'ОПС' }
    ]
  });

  const zhk1Objects = [
    { key: 'steny',   label: 'Стены',           criterion: 'Стены' },
    { key: 'poly',    label: 'Полы',            criterion: 'Полы' },
    { key: 'potolki', label: 'Потолки',         criterion: 'Потолки' },
    { key: 'elektro', label: 'Электроснабжение', criterion: 'Электроснабжение' },
    { key: 'okno1',   label: 'Окно №1',         criterion: 'Окно' }
  ];
  if (winR1 >= 2) zhk1Objects.push({ key: 'okno2', label: 'Окно №2', criterion: 'Окно' });
  zhk1Objects.push({ key: 'radiator1', label: 'Радиатор №1', criterion: 'Радиатор' });
  if (winR1 >= 2) zhk1Objects.push({ key: 'radiator2', label: 'Радиатор №2', criterion: 'Радиатор' });
  divisions.push({ key: 'zhk1', title: 'Жилая комната №1', objects: zhk1Objects });

  if (roomsNum >= 2) {
    const zhk2Objects = [
      { key: 'steny',   label: 'Стены',           criterion: 'Стены' },
      { key: 'poly',    label: 'Полы',            criterion: 'Полы' },
      { key: 'potolki', label: 'Потолки',         criterion: 'Потолки' },
      { key: 'elektro', label: 'Электроснабжение', criterion: 'Электроснабжение' },
      { key: 'okno1',   label: 'Окно №1',         criterion: 'Окно' }
    ];
    if (winR2 >= 2) zhk2Objects.push({ key: 'okno2', label: 'Окно №2', criterion: 'Окно' });
    zhk2Objects.push({ key: 'radiator1', label: 'Радиатор №1', criterion: 'Радиатор' });
    if (winR2 >= 2) zhk2Objects.push({ key: 'radiator2', label: 'Радиатор №2', criterion: 'Радиатор' });
    divisions.push({ key: 'zhk2', title: 'Жилая комната №2', objects: zhk2Objects });
  }

  if (roomsNum >= 3) {
    const zhk3Objects = [
      { key: 'steny',   label: 'Стены',           criterion: 'Стены' },
      { key: 'poly',    label: 'Полы',            criterion: 'Полы' },
      { key: 'potolki', label: 'Потолки',         criterion: 'Потолки' },
      { key: 'elektro', label: 'Электроснабжение', criterion: 'Электроснабжение' },
      { key: 'okno1',   label: 'Окно №1',         criterion: 'Окно' }
    ];
    if (winR3 >= 2) zhk3Objects.push({ key: 'okno2', label: 'Окно №2', criterion: 'Окно' });
    zhk3Objects.push({ key: 'radiator1', label: 'Радиатор №1', criterion: 'Радиатор' });
    if (winR3 >= 2) zhk3Objects.push({ key: 'radiator2', label: 'Радиатор №2', criterion: 'Радиатор' });
    divisions.push({ key: 'zhk3', title: 'Жилая комната №3', objects: zhk3Objects });
  }

  const kuhnyaObjects = [
    { key: 'steny',   label: 'Стены',           criterion: 'Стены' },
    { key: 'poly',    label: 'Полы',            criterion: 'Полы' },
    { key: 'potolki', label: 'Потолки',         criterion: 'Потолки' },
    { key: 'elektro', label: 'Электроснабжение', criterion: 'Электроснабжение' },
    { key: 'okno1',   label: 'Окно №1',         criterion: 'Окно' }
  ];
  if (winK >= 2) kuhnyaObjects.push({ key: 'okno2', label: 'Окно №2', criterion: 'Окно' });
  kuhnyaObjects.push({ key: 'radiator1', label: 'Радиатор №1', criterion: 'Радиатор' });
  if (winK >= 2) kuhnyaObjects.push({ key: 'radiator2', label: 'Радиатор №2', criterion: 'Радиатор' });
  kuhnyaObjects.push({ key: 'kanalizaciya', label: 'Канализация', criterion: 'Канализация' });
  kuhnyaObjects.push({ key: 'ventilyaciya', label: 'Вентиляция', criterion: 'Вентиляция' });
  divisions.push({ key: 'kuhnya', title: 'Кухня', objects: kuhnyaObjects });

  divisions.push({
    key: 'su1', title: 'Сан. узел №1',
    objects: [
      { key: 'steny',   label: 'Стены',           criterion: 'Стены' },
      { key: 'poly',    label: 'Полы',            criterion: 'Полы' },
      { key: 'potolki', label: 'Потолки',         criterion: 'Потолки' },
      { key: 'elektro', label: 'Электроснабжение', criterion: 'Электроснабжение' },
      { key: 'kanalizaciya', label: 'Канализация', criterion: 'Канализация' },
      { key: 'ventilyaciya', label: 'Вентиляция', criterion: 'Вентиляция' }
    ]
  });

  if (bathrooms >= 2) {
    divisions.push({
      key: 'su2', title: 'Сан. узел №2',
      objects: [
        { key: 'steny',   label: 'Стены',           criterion: 'Стены' },
        { key: 'poly',    label: 'Полы',            criterion: 'Полы' },
        { key: 'potolki', label: 'Потолки',         criterion: 'Потолки' },
        { key: 'elektro', label: 'Электроснабжение', criterion: 'Электроснабжение' },
        { key: 'kanalizaciya', label: 'Канализация', criterion: 'Канализация' },
        { key: 'ventilyaciya', label: 'Вентиляция', criterion: 'Вентиляция' }
      ]
    });
  }

  divisions.push({
    key: 'vodosnabzhenie', title: 'Водоснабжение',
    objects: [
      { key: 'vodosnabzhenie', label: 'Водоснабжение', criterion: 'Водоснабжение' }
    ]
  });

  if (isYes(wardrobe)) {
    divisions.push({
      key: 'garderobnaya', title: 'Гардеробная',
      objects: [
        { key: 'steny',   label: 'Стены',           criterion: 'Стены' },
        { key: 'poly',    label: 'Полы',            criterion: 'Полы' },
        { key: 'potolki', label: 'Потолки',         criterion: 'Потолки' },
        { key: 'elektro', label: 'Электроснабжение', criterion: 'Электроснабжение' }
      ]
    });
  }

  if (isYes(laundry)) {
    divisions.push({
      key: 'prachechnaya', title: 'Прачечная',
      objects: [
        { key: 'steny',   label: 'Стены',           criterion: 'Стены' },
        { key: 'poly',    label: 'Полы',            criterion: 'Полы' },
        { key: 'potolki', label: 'Потолки',         criterion: 'Потолки' },
        { key: 'elektro', label: 'Электроснабжение', criterion: 'Электроснабжение' }
      ]
    });
  }

  divisions.push({
    key: 'lodzhiya', title: 'Лоджия',
    objects: [
      { key: 'obshie',  label: 'Общие замечания', criterion: 'Лоджия. Общие замечания' },
      { key: 'potolki', label: 'Потолки',         criterion: 'Лоджия. Потолки' },
      { key: 'okno',    label: 'Окно',            criterion: 'Окно' }
    ]
  });

  divisions.push({
    key: 'dopolnitelno', title: 'Дополнительная информация', objects: []
  });

  return { divisions: divisions };
}

// Собираем форму: структура + варианты замечаний из кэша
function buildFormData(apartment, remarksRules) {
  const structure = buildFormStructure(apartment);
  const rules = remarksRules || {};

  structure.divisions.forEach(div => {
    div.objects.forEach(obj => {
      const answersForType = rules[obj.criterion] || {};
      if (Array.isArray(answersForType)) {
        obj.variants = answersForType;
      } else {
        obj.variants = Object.keys(answersForType).map(variant => ({
          variant: variant,
          text: answersForType[variant]
        }));
      }
    });
  });

  return structure;
}

window.localForm = {
  buildFormStructure: buildFormStructure,
  buildFormData: buildFormData
};
