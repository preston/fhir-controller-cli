# Health Services Platform Agent and Command Line Interface

The `hsp` command line utility for interacting with a remote HSPC Marketplace (or compatible) deployment from an on-premise or cloud host. This cross-platform executable provides a:

* Command line interface to a Marketplace deployment.
* "Agent" mode for real-time routing of remote Marketplace commands to a local Docker engine, swarm, or other orchestration agent.

## Installation

A recent version of Ruby is required. We recommend the current stable version.

```ruby
gem install hsp
```

Built-in help is provided in each respective binary:

    $ hsp --help


## Development

After checking out the repo, run `bin/setup` to install dependencies. Then, run `rake test` to run the tests. You can also run `bin/console` for an interactive prompt that will allow you to experiment.

To install this gem onto your local machine, run `bundle exec rake install`. To release a new version, update the version number in `version.rb`, and then run `bundle exec rake release`, which will create a git tag for the version, push git commits and tags, and push the `.gem` file to [rubygems.org](https://rubygems.org).

## License

This software is released under the Apache 2.0 license. Copyright (c) Preston Lee.

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/preston/hsp. This project is intended to be a safe, welcoming space for collaboration, and contributors are expected to adhere to the [Contributor Covenant](http://contributor-covenant.org) code of conduct.
