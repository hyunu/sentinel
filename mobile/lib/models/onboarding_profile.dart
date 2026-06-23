class OnboardingProfile {
  final String id;
  final String name;
  final String ssid;
  final String password;
  final String serverUrl;
  final int? baudRate;
  final DateTime updatedAt;

  const OnboardingProfile({
    required this.id,
    required this.name,
    required this.ssid,
    required this.password,
    required this.serverUrl,
    this.baudRate,
    required this.updatedAt,
  });

  factory OnboardingProfile.fromJson(Map<String, dynamic> json) {
    return OnboardingProfile(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      ssid: json['ssid'] as String? ?? '',
      password: json['password'] as String? ?? '',
      serverUrl: json['serverUrl'] as String? ?? '',
      baudRate: json['baudRate'] is int ? json['baudRate'] as int : int.tryParse('${json['baudRate']}'),
      updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '') ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'ssid': ssid,
        'password': password,
        'serverUrl': serverUrl,
        if (baudRate != null) 'baudRate': baudRate,
        'updatedAt': updatedAt.toUtc().toIso8601String(),
      };

  OnboardingProfile copyWith({
    String? name,
    String? ssid,
    String? password,
    String? serverUrl,
    int? baudRate,
    DateTime? updatedAt,
  }) {
    return OnboardingProfile(
      id: id,
      name: name ?? this.name,
      ssid: ssid ?? this.ssid,
      password: password ?? this.password,
      serverUrl: serverUrl ?? this.serverUrl,
      baudRate: baudRate ?? this.baudRate,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
