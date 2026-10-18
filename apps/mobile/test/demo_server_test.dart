import 'package:bim/features/demo/demo_server.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('adresse du serveur de démo : http:// et port 3000 ajoutés si absents', () {
    expect(DemoServer.normalize('192.168.1.20'), 'http://192.168.1.20:3000');
    expect(DemoServer.normalize(' 192.168.1.20:8080 '), 'http://192.168.1.20:8080');
    expect(DemoServer.normalize('http://10.0.0.5:3000'), 'http://10.0.0.5:3000');
    expect(DemoServer.normalize(''), isNull);
  });
}
