const regions = new Set("ae af al am ao ar au aw az ba bb bd bh bi bm bn bo br bs bt bw by bz ca cd ch cl cm cn co cr cu cv cz dj dk do dz eg er et eu fj fk gb ge gg gh gi gm gn gt gy hk hn ht hu id il im in iq ir is je jm jo jp ke kg kh km kp kr kw ky kz la lb lk lr ls ly ma md mg mk mm mn mo mr mu mv mw mx my mz na ng ni no np nz om pa pe pg ph pk pl py qa ro rs ru rw sa sb sc sd se sg sh sl so sr ss st sv sy sz th tj tm tn to tr tt tw tz ua ug us uy uz ve vn vu ws ye za zm zw".split(' '));
export function flagFor(currency) {
  const region = currency === 'EUR' ? 'eu' : currency.startsWith('X') ? '' : currency.slice(0, 2).toLowerCase();
  return '/static/flags/' + (regions.has(region) ? region : 'neutral') + '.svg';
}
