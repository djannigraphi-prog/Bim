/// Dates en français sans dépendance (le paquet intl a été retiré, voir DECISIONS.md).
library;

const _months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const _monthsShort = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const _weekdays = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

DateTime parseDay(String day) => DateTime.parse('${day}T00:00:00Z');

/// « mardi 14 octobre »
String longDay(String day) {
  final d = parseDay(day);
  return '${_weekdays[d.weekday - 1]} ${d.day} ${_months[d.month - 1]}';
}

/// « 16 déc. »
String shortDay(String day) {
  final d = parseDay(day);
  return '${d.day} ${_monthsShort[d.month - 1]}';
}

String addDaysTo(String day, int n) => parseDay(day).add(Duration(days: n)).toIso8601String().substring(0, 10);

String capitalize(String s) => s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';

/// « 15:00 » → « 15 h » ; « 07:30 » → « 7 h 30 ».
String hourFr(String hhmm) {
  final parts = hhmm.split(':');
  final h = int.tryParse(parts.first) ?? 0;
  final m = parts.length > 1 ? parts[1] : '00';
  return m == '00' ? '$h h' : '$h h $m';
}
