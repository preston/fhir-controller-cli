
require 'thor'
require 'httparty'

require_relative 'cli/users'
require_relative 'cli/platforms'
require_relative 'cli/services'
require_relative 'cli/builds'

module Hsp
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

            desc 'services SUBCOMMAND ..ARGS', 'Available marketplace services.'
            subcommand 'services', Hsp::Cli::Services

            desc 'builds SUBCOMMAND ..ARGS', 'Builds of a given service.'
            subcommand 'builds', Hsp::Cli::Services

            desc 'platforms SUBCOMMAND ..ARGS', 'Register platform(s) for known users.'
            subcommand 'platforms', Hsp::Cli::Platforms

            desc 'users SUBCOMMAND ..ARGS', 'Marketplace users.'
            subcommand 'users', Hsp::Cli::Users

            desc 'agent', 'Minion mode for commands issued by the marketplace.'
            option :websocket_url, type: :string
            option :rest_url, type: :string
            option :platform_id, required: true, type: :string
            option :platform_secret, required: true, type: :string
            def agent
                m = Marketplace.new
                m.websocket_url = options[:websocket_url] if options[:websocket_url]
                m.rest_url = options[:rest_url] if options[:rest_url]
                response = HTTParty.get(m.services_url(options[:service_id]), headers: Hsp::Client.headers)
                json = JSON.parse(response.body)
                agent = Hsp::Agent.new(m, Hsp::Orchestrator::Docker.new, options[:platform_id], options[:platform_secret]) # TODO: Make agnostic to orchestration platform
                agent.run
            end
        end
    end
end
