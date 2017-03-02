require 'thor'
require 'httparty'

module Hsp
    module Cli
        class Builds < Thor
            no_commands do
                def print_builds(json)
                    puts "\n#{json['total_results']} total builds found."
                    puts "Page #{json['current_page']} of #{json['total_pages']} (Previous: #{json['previous_page'].nil? ? 'N/A' : json['previous_page']}, Next: #{json['next_page'].nil? ? 'N/A' : json['next_page']})"
                    puts "ID\t\t\t\t\tName\t\tSecret"
                    puts_bar
                    json['results'].each do |n|
                        puts "#{n['id']}\t#{n['name']}\t#{n['public_key']}"
                    end
                    puts "\n"
                end

                def puts_bar
                    puts '--------' * 8
                end
            end

            desc 'list', 'Lists builds of a given service'
            option :service_id, required: true, type: :string
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
                response = HTTParty.get(m.builds_url(options[:service_id]), query: query, headers: Hsp::Client.headers)
                json = JSON.parse(response.body)
                # puts json
                print_builds(json)
              end

            desc 'show', 'Print details on a specific build.'
            option :service_id, required: true, type: :string
            option :build_id, required: true, type: :string
            def show
                m = Marketplace.new
                response = HTTParty.get(m.builds_url(options[:service_id], options[:build_id]), headers: Hsp::Client.headers)
                json = JSON.parse(response.body)
                # puts json
                puts ''
                puts json['name']
                puts_bar
                #   puts json['description']
                puts "ID: #{json['id']}"
                puts "Service ID: #{json['service_id']}"
                puts "Secret: #{json['public_key']}"
                puts "Created: #{json['created_at']}"
                puts "Updated: #{json['updated_at']}"
                puts "URL: #{json['url']}"
                puts "Path: #{json['path']}"
                puts ''
            end
        end
    end
end
