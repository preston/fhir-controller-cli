require 'docker'

module Marketplace
    module Orchestrator
        class Docker
            attr_accessor :url
            def initialize(url = nil)
                self.url = url if url
            end

            def status
                Docker.info
            end

            def dispatch(event)
                case event.dig('message', 'resource_type')
                when 'instance'
                    dispatch_instance(event)
                else
                    puts "Unsupported event type '#{event.dig('resource_type')}' received! It will be ignored."
                end
            end

            def dispatch_instance(event)
                puts "The server says: #{event.dig('message', 'message')}"
                case event.dig('message', 'event_type')
                when 'created'
                    deploy(event.dig('message'))
                end
            end

            def deploy(message)
                # puts "DEBUG: #{message.dig('model', 'instance', 'build')}"
                repository = message.dig('model', 'instance', 'build', 'container_repository')
                tag = message.dig('model', 'instance', 'build', 'container_tag')
                if repository && tag
                    label = "#{repository}:#{tag}"
                    puts "Attempting to load '#{label}'..."
                    image = ::Docker::Image.create('fromImage' => label)
                    if ::Docker::Image.exist?(label)
                        puts 'Found! Downloading...'
                        image = ::Docker::Image.get(label)
                        puts 'Running...'
                        declared_ports = image.info['ContainerConfig']['ExposedPorts']
                        port_bindings = declared_ports.clone
                        port_bindings.each do |k, v| port_bindings[k] = [{}] end
                        container = ::Docker::Container.create(
                            'Image' => label,
                            'ExposedPorts' => declared_ports,
                            # 'Detach' => true,
                            'HostConfig' => {
                                'PortBindings' => port_bindings
                            }
                        )
                        # require 'byebug'
                        # byebug
                        # FIXME HACK HORRIBLE temporary workaround for not knowing how to make this non-blocking. :_(
                        crap = Thread.new {
                            c = container.run(nil)
                            puts "CONTAINER: #{c.info['Ports']}"
                            # TODO Implement logging of event details back to the server side!
                        }
                    else
                        puts "Image does not exist. Are you sure #{label} is correct and accessible?"
                    end
                else
                    puts 'Both repository and tag must be included in the event!'
                end
            end

            def undeploy; end

            def sync_platform(platform_id); end
        end
   end
end
