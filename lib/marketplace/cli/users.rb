
require 'thor'
require 'httparty'

module Marketplace
    module Cli
        class Users < Thor
            no_commands do
                def print_users(json)
                    puts "\n#{json['total_results']} total users found."
                    puts "Page #{json['current_page']} of #{json['total_pages']} (Previous: #{json['previous_page'].nil? ? 'N/A' : json['previous_page']}, Next: #{json['next_page'].nil? ? 'N/A' : json['next_page']})"
                    puts "ID\t\t\t\t\tName\t\tCreated"
                    puts_bar
                    json['results'].each do |n|
                        puts "#{n['id']}\t#{n['name']}\t#{n['created_at']}"
                    end
                    puts "\n"
                end

                def puts_bar
                    puts '--------' * 8
                end
            end

            desc 'list', 'Lists all available users'
            option :page, type: :numeric
            option :per_page, type: :numeric
            def list
                m = Marketplace.new
                query = {
                    page: 1,
                    per_page: 10
                }
                query[:page] = options[:page].to_i if options[:page]
                query[:per_page] = options[:per_page].to_i if options[:per_page]
                response = HTTParty.get(m.users_url, query: query, headers: Marketplace::Client.headers)
                json = JSON.parse(response.body)
                puts json
                print_users(json)
              end

            desc 'builds', 'Builds of a given users'
            option :user_id, required: true, type: :string
            option :page, type: :numeric
            option :per_page, type: :numeric
            def builds
                m = Marketplace.new
                query = {
                    page: 1,
                    per_page: 10
                }
                query[:page] = options[:page].to_i if options[:page]
                query[:per_page] = options[:per_page].to_i if options[:per_page]
                response = HTTParty.get(m.builds_url(options[:user_id]), query: query, headers: Marketplace::Client.headers)
                json = JSON.parse(response.body)
                # puts json
                print_builds(json)
              end

            desc 'show', 'Print details on a given user'
            option :user_id, required: true, type: :string
            def show
                m = Marketplace.new
                response = HTTParty.get(m.users_url(options[:user_id]), headers: Marketplace::Client.headers)
                json = JSON.parse(response.body)
                # puts json
                puts ''
                puts json['name']
                puts_bar
                puts json['description']
                puts "URI: #{json['uri']}"
                puts "Support URL: #{json['support_url']}"
                puts "License: #{json['license_id']}"
                puts "Created: #{json['created_at']}"
                puts "Updated: #{json['updated_at']}"
                puts "Published: #{json['published_at']}"
                puts ''
            end
        end
  end
end
