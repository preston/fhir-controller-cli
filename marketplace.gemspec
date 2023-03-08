# coding: utf-8
lib = File.expand_path('../lib', __FILE__)
$LOAD_PATH.unshift(lib) unless $LOAD_PATH.include?(lib)
require 'marketplace/version'

Gem::Specification.new do |spec|
  spec.name          = "marketplace"
  spec.version       = Marketplace::VERSION
  spec.authors       = ["Preston Lee"]
  spec.email         = ["preston.lee@prestonlee.com"]

  spec.summary       = %q{Marketplace command line utilities.}
  spec.description   = %q{Command line utilities for interacting with an account on any compatible Marketplace server.}
  spec.homepage      = "https://github.com/preston/marketplace-agent"

  spec.files         = `git ls-files -z`.split("\x0").reject do |f|
    f.match(%r{^(test|spec|features)/})
  end

  spec.executables   = spec.files.grep(%r{^bin/}) { |f| File.basename(f) }
  spec.require_paths = ["lib"]

  spec.add_dependency "thor", '>= 1.2.1'
  spec.add_dependency "httparty", '>= 0.14.0'
  spec.add_dependency "space_elevator", '>= 0.2.0'
  spec.add_dependency "docker-api", '>= 2.2.0'
  spec.add_dependency "eventmachine", '>= 1.2.7'
  spec.add_dependency "em-websocket-client", '>= 0.1.2'

  spec.add_development_dependency "bundler", ">= 2.4.6"
  spec.add_development_dependency "rake", ">= 13.0.6"
  spec.add_development_dependency "minitest", ">= 5.18"
end
