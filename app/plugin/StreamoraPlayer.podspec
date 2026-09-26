Pod::Spec.new do |s|
  s.name = 'StreamoraPlayer'
  s.version = '1.0.0'
  s.summary = 'Native VLC player for the Streamora app'
  s.license = 'MIT'
  s.homepage = 'https://github.com/KNIGHTABDO/streamora'
  s.author = 'Streamora'
  s.source = { :git => 'https://github.com/KNIGHTABDO/streamora.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.dependency 'MobileVLCKit', '~> 3.7'
  s.swift_version = '5.1'
end
