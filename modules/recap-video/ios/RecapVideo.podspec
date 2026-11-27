Pod::Spec.new do |s|
  s.name           = 'RecapVideo'
  s.version        = '1.0.0'
  s.summary        = 'Writes the event recap to an MP4 on the device'
  s.description    = 'Writes the event recap to an MP4 on the device'
  s.license        = 'UNLICENSED'
  s.author         = 'RollCal'
  s.homepage       = 'https://rollcal.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
