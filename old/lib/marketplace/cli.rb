require 'thor'
require 'httparty'

require_relative 'cli/users'
require_relative 'cli/platforms'
require_relative 'cli/products'
require_relative 'cli/builds'

module Marketplace
    class Client
        def self.headers
            { 'Accept' => 'application/json' }
        end
    end

    module Cli
        class Main < Thor
            # desc 'login USERNAME URL', 'Logs in with the given to username to the provided URL.'
            # def login(_username, url)
            #     puts url
            # end

            desc 'products SUBCOMMAND ..ARGS', 'Available marketplace products.'
            subcommand 'products', Marketplace::Cli::Products

            desc 'builds SUBCOMMAND ..ARGS', 'Builds of a given product.'
            subcommand 'builds', Marketplace::Cli::Products

            desc 'platforms SUBCOMMAND ..ARGS', 'Register platform(s) for known users.'
            subcommand 'platforms', Marketplace::Cli::Platforms

            desc 'users SUBCOMMAND ..ARGS', 'Marketplace users.'
            subcommand 'users', Marketplace::Cli::Users

            desc 'agent', 'Agent mode for processing commands pushed by a remote marketplace.'
            option :websocket_url, type: :string
            option :rest_url, type: :string
            option :platform_id, required: true, type: :string
            option :platform_secret, required: true, type: :string
            option :show_pings, type: :boolean
            def agent
                m = Marketplace.new
                m.websocket_url = options[:websocket_url] if options[:websocket_url]
                m.rest_url = options[:rest_url] if options[:rest_url]
                response = HTTParty.get(m.products_url(options[:product_id]), headers: Marketplace::Client.headers)
                json = JSON.parse(response.body)
                # TODO Don't hardcode the Docker API implementation! For now, though, it's fine.
                agent = Marketplace::Agent.new(m, Marketplace::Orchestrator::Docker.new, options[:platform_id], options[:platform_secret]) # TODO: Make agnostic to orchestration platform
                agent.run(options[:platform_id], !!options[:show_pings])
            end

            desc 'version', 'Prints the client version number.'
            def version
                puts Marketplace::VERSION
            end
        end
    end
end
