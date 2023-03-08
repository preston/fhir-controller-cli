
require 'thor'
require 'httparty'

module Marketplace
    module Cli
        class Products < Thor
            no_commands do
                def print_products(json)
                    puts "\n#{json['total_results']} total products found."
                    puts "Page #{json['current_page']} of #{json['total_pages']} (Previous: #{json['previous_page'].nil? ? 'N/A' : json['previous_page']}, Next: #{json['next_page'].nil? ? 'N/A' : json['next_page']})"
                    puts "ID\t\t\t\t\tName - Description"
                    puts_bar
                    json['results'].each do |n|
                        puts "#{n['id']}\t#{n['name']} - #{n['description'][0..60]}..."
                    end
                    puts "\n"
                end

                def puts_bar
                    puts '--------' * 8
                end
            end

            desc 'list', 'Lists all available products'
            option :page, type: :numeric
            option :per_page, type: :numeric
            def list
                m = Marketplace::Client.new
                query = {
                    page: 1,
                    per_page: 10
                }
                query[:page] = options[:page].to_i if options[:page]
                query[:per_page] = options[:per_page].to_i if options[:per_page]
                response = HTTParty.get(m.products_url, query: query, headers: Marketplace::Client.headers)
                json = JSON.parse(response.body)
                # puts json
                print_products(json)
            end

            desc 'show', 'Print details on a given product'
            option :product_id, required: true, type: :string
            def show
                m = Marketplace.new
                response = HTTParty.get(m.products_url(options[:product_id]), headers: Marketplace::Client.headers)
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
